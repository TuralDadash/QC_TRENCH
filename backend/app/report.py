"""Result serialization.

to_json() builds the final dict matching the schema in the plan file.
to_pdf() is a stub — see improvements.md for the post-hackathon plan.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Iterable

from app.classify import SegmentAggregation


def to_json(
    *,
    photos: list[dict],
    segment_aggregations: list[SegmentAggregation],
    route_id: str,
) -> dict:
    category_counts = {"green": 0, "yellow": 0, "red": 0, "cat4": 0}
    duplicate_count = 0
    off_route_count = 0
    address_found = 0
    address_note_total = 0
    depth_uncertain = 0
    review_count = 0
    skipped_vlm_count = 0
    addresses: list[dict] = []

    for p in photos:
        if p.get("skipped_vlm"):
            skipped_vlm_count += 1
        cat = p.get("category", "cat4")
        category_counts[cat] = category_counts.get(cat, 0) + 1
        if p.get("duplicate_of"):
            duplicate_count += 1
        if p.get("reason") == "off_route":
            off_route_count += 1
        signals = p.get("signals", {}) or {}
        addr = signals.get("address_label", {}) or {}
        if addr.get("found"):
            address_found += 1
            note_count = int(addr.get("paper_note_count") or 1)
            address_note_total += note_count
            text = (addr.get("text") or "").strip()
            if text:
                addresses.append(
                    {
                        "photo_id": p.get("id"),
                        "filename": p.get("filename"),
                        "text": text,
                        "paper_note_count": note_count,
                    }
                )
        if signals.get("depth", {}).get("uncertain"):
            depth_uncertain += 1
        if p.get("needs_human_review"):
            review_count += 1

    duplicate_addresses = _find_duplicate_addresses(addresses)

    segments_payload = [
        {
            "id": s.id,
            "status": s.status,
            "photo_count": s.photo_count,
            "photo_ids": s.photo_ids,
            "coverage_gaps_m": [list(gap) for gap in s.coverage_gaps_m],
            "bin_summary": s.bin_summary,
        }
        for s in segment_aggregations
    ]

    photos_payload = [_strip_photo(p) for p in photos]
    duplicate_comparison = _compare_clusterings(photos)

    return {
        "route_id": route_id,
        "photos": photos_payload,
        "segments": segments_payload,
        "addresses": addresses,
        "duplicate_addresses": duplicate_addresses,
        "duplicate_comparison": duplicate_comparison,
        "aggregates": {
            "total_photos": len(photos),
            "category_counts": category_counts,
            "duplicate_count": duplicate_count,
            "off_route_count": off_route_count,
            "address_labels_found": address_found,
            "address_paper_notes_total": address_note_total,
            "depth_uncertain_count": depth_uncertain,
            "needs_human_review_count": review_count,
            "skipped_vlm_count": skipped_vlm_count,
            "vlm_calls_made": len(photos) - skipped_vlm_count,
            "segment_status_counts": _segment_status_counts(segment_aggregations),
        },
    }


def _strip_photo(p: dict) -> dict:
    return {
        "id": p["id"],
        "filename": p.get("filename"),
        "phash": p.get("phash"),
        "category": p.get("category", "cat4"),
        "reason": p.get("reason"),
        "segment_id": p.get("segment_id"),
        "segment_distance_m": p.get("segment_distance_m"),
        "segment_position_m": p.get("segment_position_m"),
        "metadata": p.get("metadata"),
        "signals": p.get("signals"),
        "duplicate_of": p.get("duplicate_of"),
        "duplicate_of_phash": p.get("duplicate_of_phash"),
        "duplicate_of_metadata": p.get("duplicate_of_metadata"),
        "skipped_vlm": p.get("skipped_vlm", False),
        "needs_human_review": p.get("needs_human_review", False),
        "review_reasons": p.get("review_reasons", []),
        "error": p.get("error"),
    }


def _segment_status_counts(seg_aggs: Iterable[SegmentAggregation]) -> dict:
    counts = {"green": 0, "yellow": 0, "red": 0}
    for s in seg_aggs:
        counts[s.status] = counts.get(s.status, 0) + 1
    return counts


def _find_duplicate_addresses(addresses: list[dict]) -> list[dict]:
    by_text: dict[str, list[dict]] = defaultdict(list)
    for a in addresses:
        key = _normalize_address(a["text"])
        if key:
            by_text[key].append(a)
    return [
        {
            "text": entries[0]["text"],
            "count": len(entries),
            "photo_ids": [e["photo_id"] for e in entries],
            "filenames": [e["filename"] for e in entries],
        }
        for entries in by_text.values()
        if len(entries) > 1
    ]


def _normalize_address(text: str) -> str:
    return " ".join(text.lower().split())


def _compare_clusterings(photos: list[dict]) -> dict:
    """Diff the pHash and metadata-only clusterings on the same photos."""
    phash_dup = {p["id"]: p.get("duplicate_of_phash") for p in photos}
    meta_dup = {p["id"]: p.get("duplicate_of_metadata") for p in photos}

    phash_flagged = {pid for pid, parent in phash_dup.items() if parent}
    meta_flagged = {pid for pid, parent in meta_dup.items() if parent}

    agree_both = sorted(
        pid for pid in phash_flagged & meta_flagged
        if phash_dup[pid] == meta_dup[pid]
    )
    disagree_parent = sorted(
        pid for pid in phash_flagged & meta_flagged
        if phash_dup[pid] != meta_dup[pid]
    )
    phash_only = sorted(phash_flagged - meta_flagged)
    metadata_only = sorted(meta_flagged - phash_flagged)

    # Cluster Jaccard: treat each clustering as a set of unordered {id, parent}
    # edges between a duplicate and its root. Identical clusterings -> 1.0.
    phash_edges = {frozenset({pid, parent}) for pid, parent in phash_dup.items() if parent}
    meta_edges = {frozenset({pid, parent}) for pid, parent in meta_dup.items() if parent}
    union = phash_edges | meta_edges
    jaccard = len(phash_edges & meta_edges) / len(union) if union else 1.0

    return {
        "phash_duplicate_count": len(phash_flagged),
        "metadata_duplicate_count": len(meta_flagged),
        "agree_both": agree_both,
        "phash_only": phash_only,
        "metadata_only": metadata_only,
        "disagree_parent": disagree_parent,
        "cluster_jaccard": round(jaccard, 4),
    }


def to_pdf(
    db_data: dict,
    path: Path,
    *,
    meta: dict | None = None,
    length_m: float | None = None,
    cat4_overrides: dict | None = None,
) -> None:
    """Render a customer PDF report from `app.db.fetch_report_data` output.

    Cover-block + trench length + Cat-4 sub-reasons not yet in DB come from
    the caller (see `app.main` /api/report/pdf endpoint).
    """
    from app.pdf_render import build_pdf
    build_pdf(path, db_data, meta=meta, length_m=length_m, cat4_overrides=cat4_overrides)
