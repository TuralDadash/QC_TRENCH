"""Orchestrator for the trench-photo audit.

Eight steps per photo, plus two cross-photo passes (duplicate clustering,
segment aggregation). Returns a JSON-shaped dict; the caller decides what
to do with it (write to disk, return from FastAPI, render to PDF).
"""

from __future__ import annotations

import asyncio
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from PIL import Image

from app import ai_detect, classify, duplicates, geo, report, vlm

# Austria-ish bbox for sanity-checking burnt-in GPS.
# Loose enough to cover all of Austria; tight enough to drop obvious garbage.
AT_BBOX = (46.0, 49.5, 9.0, 17.5)  # (lat_min, lat_max, lon_min, lon_max)
MIN_VALID_YEAR = 2020


def _validate_metadata(meta: vlm.BurntInMetadata) -> tuple[Optional[tuple[float, float]], Optional[str], bool]:
    """Return ((lat,lon) or None, timestamp_iso or None, valid_flag)."""
    gps = None
    if meta.gps_lat is not None and meta.gps_lon is not None:
        lat, lon = meta.gps_lat, meta.gps_lon
        if AT_BBOX[0] <= lat <= AT_BBOX[1] and AT_BBOX[2] <= lon <= AT_BBOX[3]:
            gps = (lat, lon)
    ts_iso = None
    if meta.timestamp_iso:
        try:
            dt = datetime.fromisoformat(meta.timestamp_iso.replace("Z", "+00:00"))
            now = datetime.now(tz=dt.tzinfo) if dt.tzinfo else datetime.now()
            if dt.year >= MIN_VALID_YEAR and dt <= now:
                ts_iso = dt.isoformat()
        except ValueError:
            ts_iso = None
    valid = gps is not None or ts_iso is not None
    return gps, ts_iso, valid


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _phash_hex(phash_int: int) -> str:
    return f"{phash_int:064x}"


def _process_one_sync(
    photo_path: Path,
    assess_fn: Callable[[bytes, str], vlm.PhotoAssessment],
) -> dict:
    """Step 1-5 for a single photo. Returns a raw record to be enriched later."""
    photo_id = uuid.uuid4().hex[:10]
    image_bytes = photo_path.read_bytes()
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Exception as e:
        return {
            "id": photo_id,
            "filename": photo_path.name,
            "error": f"decode_failed: {e}",
            "category": "cat4",
            "reason": "decode_failed",
            "phash": None,
            "metadata": {"gps": None, "timestamp": None, "valid": False, "source": "burnt_in_overlay"},
            "signals": {},
            "is_likely_ai_generated": False,
            "duplicate_of": None,
            "segment_id": None,
            "segment_distance_m": None,
            "segment_position_m": None,
        }

    phash_int = duplicates.average_phash(img)
    mime = "image/jpeg" if photo_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    assessment = assess_fn(image_bytes, mime)

    detector_result = ai_detect.detect(image_bytes)
    is_ai = assessment.is_likely_ai_generated
    if detector_result is not None:
        is_ai = is_ai or detector_result["is_ai_generated"]

    gps, ts_iso, valid = _validate_metadata(assessment.burnt_in_metadata)

    return {
        "id": photo_id,
        "filename": photo_path.name,
        "phash": _phash_hex(phash_int),
        "_phash_int": phash_int,
        "metadata": {
            "gps": {"lat": gps[0], "lon": gps[1]} if gps else None,
            "timestamp": ts_iso,
            "valid": valid,
            "source": "burnt_in_overlay",
            "raw_overlay_text": assessment.burnt_in_metadata.raw_text,
        },
        "signals": {
            "duct": assessment.duct.model_dump(),
            "depth": assessment.depth.model_dump(),
            "sand_bedding": assessment.sand_bedding.model_dump(),
            "address_label": assessment.address_label.model_dump(),
            "privacy_flags": assessment.privacy_flags.model_dump(),
            "pipe_end_seals": assessment.pipe_end_seals.model_dump(),
        },
        "is_likely_ai_generated": is_ai,
        "_assessment": assessment,
        "_ai_detector_result": detector_result,
        "duplicate_of": None,
        "segment_id": None,
        "segment_distance_m": None,
        "segment_position_m": None,
    }


async def _process_async(
    photo_paths: list[Path],
    assess_fn: Callable[[bytes, str], vlm.PhotoAssessment],
    concurrency: int,
) -> list[dict]:
    loop = asyncio.get_running_loop()
    sem = asyncio.Semaphore(concurrency)
    executor = ThreadPoolExecutor(max_workers=concurrency)

    async def worker(p: Path) -> dict:
        async with sem:
            return await loop.run_in_executor(executor, _process_one_sync, p, assess_fn)

    try:
        return await asyncio.gather(*(worker(p) for p in photo_paths))
    finally:
        executor.shutdown(wait=True)


def run(
    photo_paths: list[Path],
    route_path: Path,
    *,
    concurrency: int = 4,
    assess_fn: Optional[Callable[[bytes, str], vlm.PhotoAssessment]] = None,
) -> dict:
    """Run the full pipeline and return the JSON-shaped result dict."""
    assess_fn = assess_fn or vlm.assess
    segments = geo.load_trenches(route_path)

    photos = asyncio.run(_process_async(photo_paths, assess_fn, concurrency))

    # Cross-photo: duplicate clustering
    fingerprints = [
        duplicates.PhotoFingerprint(
            id=p["id"],
            phash=p["_phash_int"],
            lat=p["metadata"]["gps"]["lat"] if p["metadata"]["gps"] else None,
            lon=p["metadata"]["gps"]["lon"] if p["metadata"]["gps"] else None,
            timestamp=_parse_iso(p["metadata"]["timestamp"]),
        )
        for p in photos
        if p.get("phash")
    ]
    dup_map = duplicates.find_clusters(fingerprints)
    for p in photos:
        p["duplicate_of"] = dup_map.get(p["id"])

    # Geo-match
    for p in photos:
        gps = p["metadata"]["gps"]
        if gps is None:
            continue
        proj = geo.project_point(gps["lat"], gps["lon"], segments)
        if proj is None:
            continue
        if proj.on_route:
            p["segment_id"] = proj.segment_id
            p["segment_distance_m"] = proj.distance_m
            p["segment_position_m"] = proj.position_along_segment_m
        else:
            p["segment_distance_m"] = proj.distance_m
            p["_off_route"] = True

    # Photo classification
    for p in photos:
        if "_assessment" in p:
            cls = classify.classify_photo(
                p["_assessment"],
                duplicate_of=p["duplicate_of"],
                off_route=p.get("_off_route", False),
            )
            p["category"] = cls.category
            p["reason"] = cls.reason
            p["needs_human_review"] = cls.needs_human_review
            p["review_reasons"] = cls.review_reasons

    # Segment aggregation needs lightweight dicts
    classified_photos = [
        {
            "id": p["id"],
            "category": p["category"],
            "segment_id": p["segment_id"],
            "segment_position_m": p["segment_position_m"] or 0.0,
        }
        for p in photos
        if p.get("category") and p.get("segment_id")
    ]
    seg_aggs = classify.aggregate_segments(segments, classified_photos)

    # Strip private fields
    for p in photos:
        p.pop("_assessment", None)
        p.pop("_phash_int", None)
        p.pop("_ai_detector_result", None)
        p.pop("_off_route", None)

    return report.to_json(
        photos=photos,
        segment_aggregations=seg_aggs,
        route_id=Path(route_path).stem,
    )
