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
    addresses: list[dict] = []

    for p in photos:
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

    return {
        "route_id": route_id,
        "photos": photos_payload,
        "segments": segments_payload,
        "addresses": addresses,
        "duplicate_addresses": duplicate_addresses,
        "aggregates": {
            "total_photos": len(photos),
            "category_counts": category_counts,
            "duplicate_count": duplicate_count,
            "off_route_count": off_route_count,
            "address_labels_found": address_found,
            "address_paper_notes_total": address_note_total,
            "depth_uncertain_count": depth_uncertain,
            "needs_human_review_count": review_count,
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


def to_pdf(result: dict, path: Path) -> None:
    """Render the JSON result to a PDF report. Stub — see improvements.md."""
    raise NotImplementedError("PDF export is planned post-hackathon. Use to_json for now.")
