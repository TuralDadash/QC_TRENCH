"""End-to-end smoke test with a mocked VLM.

Runs the full pipeline against real example photos but with a fake assess_fn
that returns scripted PhotoAssessments. Verifies every category is produced
and the final JSON schema matches the plan.

Run:
    python tests/smoke_test.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from app.pipeline import run
from app.vlm import (
    AddressLabel,
    BurntInMetadata,
    DepthSignal,
    DuctSignal,
    PhotoAssessment,
    SandBeddingSignal,
)

DUCT_DIR = Path(
    os.environ.get(
        "TRENCH_PHOTOS_DIR",
        str(REPO_ROOT.parent / "Company data" / "Beispiele" / "duct"),
    )
)
ROUTE_PATH = Path(
    os.environ.get(
        "TRENCH_ROUTE_PATH",
        str(
            REPO_ROOT.parent
            / "CLP20417A-P1-B00__P20417A_P1_SED_20231103_260515_1778825111"
            / "CLP20417A-P1-B00_Trenches_geojson.zip"
        ),
    )
)

if not DUCT_DIR.is_dir() or not ROUTE_PATH.is_file():
    print(
        f"[skip] Smoke test inputs not found.\n"
        f"  Photos: {DUCT_DIR} (set TRENCH_PHOTOS_DIR)\n"
        f"  Route:  {ROUTE_PATH} (set TRENCH_ROUTE_PATH)",
        file=sys.stderr,
    )
    sys.exit(0)

# Pick GPS values inside the actual route bbox so geo-matching works.
ROUTE_LAT = 46.5537
ROUTE_LON = 14.2957
OFF_ROUTE_LAT = 48.2000  # Vienna — far off
OFF_ROUTE_LON = 16.3700


def build_assessments():
    """Return a dict filename -> PhotoAssessment for scripted responses."""
    photos = sorted(DUCT_DIR.glob("*.jpg"))[:5]
    assert len(photos) >= 5, f"need 5 example photos under {DUCT_DIR}"

    scripted = {
        # green: both duct + depth
        photos[0].name: PhotoAssessment(
            is_construction_photo=True,
            duct=DuctSignal(visible=True, confidence=0.9),
            depth=DepthSignal(ruler_visible=True, depth_value_cm=95.0, uncertain=False, confidence=0.85),
            sand_bedding=SandBeddingSignal(status="sand", confidence=0.7),
            burnt_in_metadata=BurntInMetadata(gps_lat=ROUTE_LAT, gps_lon=ROUTE_LON, timestamp_iso="2024-07-01T10:00:00"),
            address_label=AddressLabel(found=True, text="Musterstrasse 1", confidence=0.6),
        ),
        # yellow: duct only
        photos[1].name: PhotoAssessment(
            is_construction_photo=True,
            duct=DuctSignal(visible=True, confidence=0.8),
            burnt_in_metadata=BurntInMetadata(gps_lat=ROUTE_LAT + 0.00005, gps_lon=ROUTE_LON, timestamp_iso="2024-07-01T10:05:00"),
        ),
        # red: depth only
        photos[2].name: PhotoAssessment(
            is_construction_photo=True,
            depth=DepthSignal(ruler_visible=True, depth_value_cm=80.0, uncertain=False, confidence=0.75),
            burnt_in_metadata=BurntInMetadata(gps_lat=ROUTE_LAT, gps_lon=ROUTE_LON + 0.00005, timestamp_iso="2024-07-01T10:10:00"),
        ),
        # cat4 no useful evidence
        photos[3].name: PhotoAssessment(
            is_construction_photo=False,
            burnt_in_metadata=BurntInMetadata(gps_lat=ROUTE_LAT, gps_lon=ROUTE_LON, timestamp_iso="2024-07-01T10:15:00"),
        ),
        # cat4 off-route (far from any segment)
        photos[4].name: PhotoAssessment(
            is_construction_photo=True,
            duct=DuctSignal(visible=True, confidence=0.9),
            depth=DepthSignal(ruler_visible=True, depth_value_cm=90.0, confidence=0.8, uncertain=False),
            burnt_in_metadata=BurntInMetadata(gps_lat=OFF_ROUTE_LAT, gps_lon=OFF_ROUTE_LON, timestamp_iso="2024-07-01T10:20:00"),
        ),
    }
    return photos, scripted


def main() -> int:
    photos, scripted = build_assessments()

    def fake_assess(image_bytes: bytes, mime: str = "image/jpeg") -> PhotoAssessment:
        # Look up by current photo via call counter; we'll thread filename through.
        raise RuntimeError("use fake_assess_factory")

    # We need filename in the closure. Walk photos in pipeline order: pipeline
    # processes files via _process_one_sync which calls assess_fn(image_bytes, mime).
    # We don't have filename in the signature, so instead route by phash content:
    # easier — pre-compute filename->bytes map.
    bytes_to_name = {p.read_bytes(): p.name for p in photos}

    def assess_by_bytes(image_bytes: bytes, mime: str = "image/jpeg") -> PhotoAssessment:
        name = bytes_to_name.get(image_bytes)
        if name is None:
            return PhotoAssessment()
        return scripted[name]

    result = run(photos, ROUTE_PATH, concurrency=2, assess_fn=assess_by_bytes)

    agg = result["aggregates"]
    cats = agg["category_counts"]
    print(json.dumps({"aggregates": agg}, indent=2))

    assert cats["green"] >= 1, f"expected at least one green, got {cats}"
    assert cats["yellow"] >= 1, f"expected at least one yellow, got {cats}"
    assert cats["red"] >= 1, f"expected at least one red, got {cats}"
    assert cats["cat4"] >= 2, f"expected at least 2 cat4 (none + off-route), got {cats}"
    assert agg["off_route_count"] >= 1
    assert agg["address_labels_found"] >= 1

    # Validate top-level shape
    for key in (
        "route_id",
        "photos",
        "segments",
        "aggregates",
        "addresses",
        "duplicate_addresses",
        "duplicate_comparison",
    ):
        assert key in result, f"missing key {key}"
    # Per-photo shape
    p0 = result["photos"][0]
    for key in (
        "id",
        "category",
        "metadata",
        "signals",
        "duplicate_of_phash",
        "duplicate_of_metadata",
    ):
        assert key in p0, f"photo missing key {key}"
    # Duplicate comparison block carries both counts
    comp = result["duplicate_comparison"]
    for key in (
        "phash_duplicate_count",
        "metadata_duplicate_count",
        "agree_both",
        "phash_only",
        "metadata_only",
        "cluster_jaccard",
    ):
        assert key in comp, f"duplicate_comparison missing key {key}"

    # Segment statuses
    statuses = {s["status"] for s in result["segments"]}
    assert statuses <= {"green", "yellow", "red"}

    print("smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
