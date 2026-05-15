"""Photo and segment classification rules.

Per-photo:
  duct visible AND depth ruler visible -> green
  duct visible only                    -> yellow
  depth ruler visible only             -> red
  neither                              -> cat4 (no_useful_evidence)
  duplicate / ai-generated / off-route -> cat4 with that reason (overrides above)

Per-segment: bin photos along the polyline in 5m cells, infer status from
the worst-covered bin. Bins without any photo are coverage gaps and pull
segment to at least yellow.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from app.geo import GridCell, Segment, coverage_along_route
from app.vlm import PhotoAssessment

Category = Literal["green", "yellow", "red", "cat4"]
SegmentStatus = Literal["green", "yellow", "red"]

VISIBLE_CONF_THRESHOLD = 0.4
# A "visible" signal whose confidence falls in this band could swing the photo
# category, so flag for human review.
BORDERLINE_LOW = 0.3
BORDERLINE_HIGH = 0.6
LOW_OVERALL_CONFIDENCE = 0.5
LOW_ADDRESS_CONFIDENCE = 0.5


@dataclass
class PhotoClassification:
    category: Category
    reason: Optional[str]
    needs_human_review: bool = False
    review_reasons: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.review_reasons is None:
            self.review_reasons = []


def assess_review_need(assessment) -> tuple[bool, list[str]]:
    """Decide whether a photo's signals are too uncertain to auto-classify."""
    reasons: list[str] = []

    duct = assessment.duct
    if BORDERLINE_LOW <= duct.confidence <= BORDERLINE_HIGH:
        reasons.append(f"duct_confidence_borderline:{duct.confidence:.2f}")

    depth = assessment.depth
    if BORDERLINE_LOW <= depth.confidence <= BORDERLINE_HIGH:
        reasons.append(f"depth_confidence_borderline:{depth.confidence:.2f}")
    if depth.ruler_visible and depth.uncertain:
        reasons.append("depth_ruler_unreadable")

    if assessment.sand_bedding.status == "uncertain":
        reasons.append("sand_bedding_uncertain")

    addr = assessment.address_label
    if addr.found and addr.confidence < LOW_ADDRESS_CONFIDENCE:
        reasons.append(f"address_low_confidence:{addr.confidence:.2f}")

    if assessment.overall_confidence and assessment.overall_confidence < LOW_OVERALL_CONFIDENCE:
        reasons.append(f"overall_confidence_low:{assessment.overall_confidence:.2f}")

    return bool(reasons), reasons


def classify_photo(
    assessment: PhotoAssessment,
    *,
    duplicate_of: Optional[str] = None,
    off_route: bool = False,
) -> PhotoClassification:
    needs_review, review_reasons = assess_review_need(assessment)

    if duplicate_of:
        return PhotoClassification(
            "cat4", f"duplicate_of:{duplicate_of}", needs_review, review_reasons
        )
    if assessment.is_likely_ai_generated:
        return PhotoClassification("cat4", "ai_generated", needs_review, review_reasons)
    if off_route:
        return PhotoClassification("cat4", "off_route", needs_review, review_reasons)

    duct_ok = (
        assessment.duct.visible
        and assessment.duct.confidence >= VISIBLE_CONF_THRESHOLD
    )
    depth_ok = (
        assessment.depth.ruler_visible
        and assessment.depth.confidence >= VISIBLE_CONF_THRESHOLD
    )

    if duct_ok and depth_ok:
        return PhotoClassification("green", None, needs_review, review_reasons)
    if duct_ok:
        return PhotoClassification("yellow", None, needs_review, review_reasons)
    if depth_ok:
        return PhotoClassification("red", None, needs_review, review_reasons)
    return PhotoClassification("cat4", "no_useful_evidence", needs_review, review_reasons)


@dataclass
class SegmentAggregation:
    id: str
    status: SegmentStatus
    photo_count: int
    photo_ids: list[str]
    coverage_gaps_m: list[tuple[float, float]]
    bin_summary: list[dict]


def _worst_bin_status(cell: GridCell) -> Optional[SegmentStatus]:
    if not cell.photo_ids:
        return None
    if cell.categories.get("green", 0) > 0:
        # green only if no red in this bin; red trumps green within a bin
        return "red" if cell.categories.get("red", 0) > 0 else "green"
    if cell.categories.get("yellow", 0) > 0:
        return "yellow"
    if cell.categories.get("red", 0) > 0:
        return "red"
    return "yellow"  # only cat4 in this bin — treat as gap-equivalent


def aggregate_segments(
    segments: list[Segment],
    photos: list[dict],
) -> list[SegmentAggregation]:
    """Aggregate photo classifications to segment statuses.

    photos: dicts with keys id, category, segment_id, segment_position_m.
    """
    cells_by_seg = coverage_along_route(segments, photos)
    aggregations: list[SegmentAggregation] = []
    for seg in segments:
        cells = cells_by_seg.get(seg.id, [])
        bin_statuses = [_worst_bin_status(c) for c in cells]
        statuses_present = [s for s in bin_statuses if s is not None]
        gaps = [
            (c.bin_start_m, c.bin_end_m)
            for c, s in zip(cells, bin_statuses)
            if s is None
        ]

        if not statuses_present:
            status: SegmentStatus = "red"  # no coverage at all
        elif gaps:
            # any gap pulls to at least yellow; red sticks
            if "red" in statuses_present:
                status = "red"
            else:
                status = "yellow"
        else:
            if "red" in statuses_present:
                status = "red"
            elif "yellow" in statuses_present:
                status = "yellow"
            else:
                status = "green"

        photo_ids = [pid for c in cells for pid in c.photo_ids]
        aggregations.append(
            SegmentAggregation(
                id=seg.id,
                status=status,
                photo_count=len(photo_ids),
                photo_ids=photo_ids,
                coverage_gaps_m=gaps,
                bin_summary=[
                    {
                        "start_m": c.bin_start_m,
                        "end_m": c.bin_end_m,
                        "categories": dict(c.categories),
                    }
                    for c in cells
                ],
            )
        )
    return aggregations
