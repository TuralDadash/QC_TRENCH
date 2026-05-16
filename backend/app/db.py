"""Postgres reader for the customer PDF report.

Reads the photo_metadata / photo_analyses / photo_analysis_addresses tables
that the frontend (src/lib/db.ts) initialises and populates. Only consumes
data; never writes.

Connection string comes from DATABASE_URL (see .env.example), matching the
docker-compose Postgres service.
"""

from __future__ import annotations

import os
import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

BACKEND_PATH_ID = "backend"
DEPTH_MIN_CONFIDENCE = 70
TRENCH_MIN_CONFIDENCE = 70


_BACKEND_CAT_MAP = {"green": 1, "yellow": 2, "red": 3, "cat4": 4}


def _derive_category(record: dict) -> int:
    # Photo categories per backend/CLAUDE.md domain model. Derived at read
    # time because the photo_metadata.category column is never populated
    # upstream. Duplicates are forced to cat 4. Missing GPS alone does NOT
    # downgrade to cat 4 — that's reserved for explicit off-route/mismatch.
    if record.get("has_duplicate"):
        return 4
    # Backend ("kind=backend") analyses already carry a green/yellow/red
    # label; prefer it.
    backend_cat = (record.get("backend_result") or {}).get("category")
    if backend_cat in _BACKEND_CAT_MAP:
        return _BACKEND_CAT_MAP[backend_cat]
    # Fallback for Gemini util runs — read flat columns.
    has_duct = bool(record.get("has_trench")) and (
        (record.get("has_trench_confidence") or 0) >= TRENCH_MIN_CONFIDENCE
    )
    has_depth = record.get("depth_cm") is not None
    if has_duct and has_depth:
        return 1
    if has_duct:
        return 2
    if has_depth:
        return 3
    return 4


def _conn_string() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:postgres@localhost:5432/trench_qc",
    )


def fetch_report_data(project: str | None = None) -> dict[str, Any]:
    where_project = ""
    params: list[Any] = []
    if project:
        where_project = "WHERE pm.project = %s"
        params.append(project)

    with psycopg.connect(_conn_string(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS n FROM photo_metadata pm {where_project}",
                params,
            )
            total = cur.fetchone()["n"]

            # category counts are derived after the photo loop below — the
            # photo_metadata.category column is not populated upstream.
            counts = {1: 0, 2: 0, 3: 0, 4: 0}

            cur.execute(
                f"""
                SELECT COUNT(*) AS n
                FROM photo_metadata pm
                {where_project}
                {"AND" if where_project else "WHERE"}
                  pm.category = 4 AND pm.has_duplicate = TRUE
                """,
                params,
            )
            duplicate_count = cur.fetchone()["n"]

            cur.execute(
                f"""
                SELECT pm.id AS photo_id, pm.original_name AS filename,
                       paa.address
                FROM photo_analysis_addresses paa
                JOIN photo_metadata pm ON pm.id = paa.photo_id
                {where_project}
                {"AND" if where_project else "WHERE"} paa.path_id = %s
                ORDER BY pm.original_name, paa.position
                """,
                params + [BACKEND_PATH_ID],
            )
            addresses = [
                {
                    "photo_id": r["photo_id"],
                    "filename": r["filename"],
                    "address": r["address"],
                }
                for r in cur.fetchall()
            ]
            if not addresses:
                cur.execute(
                    f"""
                    SELECT pm.id AS photo_id, pm.original_name AS filename,
                           pa.address
                    FROM photo_analyses pa
                    JOIN photo_metadata pm ON pm.id = pa.photo_id
                    {where_project}
                    {"AND" if where_project else "WHERE"} pa.path_id = %s
                      AND pa.has_address_sheet IS TRUE
                      AND pa.address IS NOT NULL
                      AND BTRIM(pa.address) <> ''
                      AND COALESCE((pa.result->'address_label'->>'paper_note_count')::int, 0) > 0
                    ORDER BY pm.original_name
                    """,
                    params + [BACKEND_PATH_ID],
                )
                addresses = _dedupe_addresses(cur.fetchall())
            # Final fallback — neither photo_analysis_addresses nor the flat
            # `pa.address` column are populated by the current frontend
            # pipeline for kind='backend'. Pull straight from the JSONB.
            if not addresses:
                cur.execute(
                    f"""
                    SELECT pm.id AS photo_id, pm.original_name AS filename,
                           pa.result->'address_label'->>'text' AS address
                    FROM photo_analyses pa
                    JOIN photo_metadata pm ON pm.id = pa.photo_id
                    {where_project}
                    {"AND" if where_project else "WHERE"} pa.path_id = %s
                      AND (pa.result->'address_label'->>'found')::boolean IS TRUE
                      AND pa.result->'address_label'->>'text' IS NOT NULL
                      AND BTRIM(pa.result->'address_label'->>'text') <> ''
                    ORDER BY pm.original_name
                    """,
                    params + [BACKEND_PATH_ID],
                )
                addresses = _dedupe_addresses(cur.fetchall())

            cur.execute(
                f"""
                SELECT pm.id, pm.original_name AS filename, pm.category,
                       pm.has_duplicate, pm.has_gps,
                       pm.latitude, pm.longitude,
                       pa.depth_cm, pa.depth_cm_confidence,
                       pa.has_trench, pa.has_trench_confidence,
                       pa.has_sand_bedding, pa.has_sand_bedding_confidence,
                       pa.has_tape,
                       pa.has_vertical_measuring_stick,
                       pa.has_address_sheet, pa.address,
                       pa.output_text,
                       pa.result AS backend_result
                FROM photo_metadata pm
                LEFT JOIN photo_analyses pa
                  ON pa.photo_id = pm.id AND pa.path_id = %s
                {where_project}
                ORDER BY pm.category NULLS LAST, pm.original_name
                """,
                [BACKEND_PATH_ID] + params,
            )
            photos = []
            for r in cur.fetchall():
                depth_cm = (
                    float(r["depth_cm"])
                    if r["depth_cm"] is not None
                    and (r["depth_cm_confidence"] or 0) >= DEPTH_MIN_CONFIDENCE
                    else None
                )
                backend_result = r["backend_result"] or {}
                # Pull depth from the backend JSON if the flat column is empty
                # (the flat columns are only populated for kind=util runs).
                if depth_cm is None and isinstance(backend_result, dict):
                    bd = backend_result.get("depth") or {}
                    dv = bd.get("depth_value_cm")
                    if isinstance(dv, (int, float)) and (bd.get("confidence") or 0) >= 0.7:
                        depth_cm = float(dv)
                # Fall back to coordinates the VLM read from the burnt-in
                # overlay when upload-time EXIF/OCR didn't capture them —
                # mirrors the frontend's analysisCoords() so the PDF map and
                # the live map agree on which photos are locatable.
                lat = float(r["latitude"]) if r["latitude"] is not None else None
                lon = float(r["longitude"]) if r["longitude"] is not None else None
                if (lat is None or lon is None) and isinstance(backend_result, dict):
                    m = backend_result.get("burnt_in_metadata") or {}
                    olat, olon = m.get("gps_lat"), m.get("gps_lon")
                    if isinstance(olat, (int, float)) and isinstance(olon, (int, float)):
                        lat, lon = float(olat), float(olon)
                rec = {
                    "id": r["id"],
                    "filename": r["filename"],
                    "has_duplicate": r["has_duplicate"],
                    "has_gps": r["has_gps"] or (lat is not None and lon is not None),
                    "latitude": lat,
                    "longitude": lon,
                    "depth_cm": depth_cm,
                    "depth_confidence": r["depth_cm_confidence"],
                    "has_trench": r["has_trench"],
                    "has_trench_confidence": r["has_trench_confidence"],
                    "has_sand_bedding": r["has_sand_bedding"],
                    "has_tape": r["has_tape"],
                    "has_measuring_stick": r["has_vertical_measuring_stick"],
                    "has_address_sheet": r["has_address_sheet"],
                    "address": r["address"],
                    "output_text": r["output_text"],
                    "backend_result": backend_result,
                }
                rec["category"] = r["category"] if r["category"] in (1, 2, 3, 4) else _derive_category(rec)
                counts[rec["category"]] += 1
                photos.append(rec)

    return {
        "total_photos": total,
        "category_counts": counts,
        "cat4_breakdown": {
            "duplicate": duplicate_count,
            "gps_inconsistent": _count_gps_inconsistent(),
            "warning_tape_only": _count_warning_tape_only(project),
            "ai_generated": _count_ai_generated(),
        },
        "addresses": addresses,
        "photos": photos,
    }


# Extension hooks: still-pending columns return None (em-dash in the PDF).
# When the frontend adds is_likely_ai_generated / gps_outside_lot to
# photo_analyses, replace the helper bodies with a SELECT COUNT(*) ...
# WHERE <col> AND path_id='backend'.

def _count_warning_tape_only(project: str | None = None) -> int | None:
    where_project = ""
    params: list[Any] = [BACKEND_PATH_ID]
    if project:
        where_project = "AND pm.project = %s"
        params.append(project)
    with psycopg.connect(_conn_string(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS n
                FROM photo_metadata pm
                JOIN photo_analyses pa
                  ON pa.photo_id = pm.id AND pa.path_id = %s
                WHERE pm.category = 4
                  AND COALESCE(pm.has_duplicate, FALSE) = FALSE
                  AND pa.has_tape IS TRUE
                  AND (pa.has_trench IS DISTINCT FROM TRUE)
                  AND pa.depth_cm IS NULL
                  {where_project}
                """,
                params,
            )
            return cur.fetchone()["n"]


def _count_ai_generated() -> int | None:
    return None


def _count_gps_inconsistent() -> int | None:
    return None


def _dedupe_addresses(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    deduped: dict[str, dict[str, str]] = {}
    for row in rows:
        note_text = row["address"].strip()
        key = _normalize_address(note_text)
        if key and key not in deduped:
            deduped[key] = {
                "photo_id": row["photo_id"],
                "filename": row["filename"],
                "address": note_text,
            }
    return list(deduped.values())


def _normalize_address(text: str) -> str:
    text = text.casefold()
    text = re.sub(r"\s+", " ", text)
    return text.strip()
