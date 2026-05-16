"""Smoke test for the PDF renderer. Does not touch Postgres."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pdf_render import build_pdf


FIXTURE = {
    "total_photos": 312,
    "category_counts": {1: 187, 2: 53, 3: 41, 4: 31},
    "cat4_breakdown": {
        "duplicate": 23,
        "gps_inconsistent": None,
        "warning_tape_only": None,
        "ai_generated": None,
    },
    "addresses": [
        {"photo_id": "p1", "filename": "IMG_0001.jpg", "address": "Salzachuferstraße 12"},
        {"photo_id": "p2", "filename": "IMG_0002.jpg", "address": "Mühlweg 3"},
    ],
    "photos": [
        {"id": "p1", "filename": "IMG_0001.jpg", "category": 1,
         "has_duplicate": False, "depth_cm": 85.0, "depth_confidence": 90,
         "has_trench": True, "has_trench_confidence": 95,
         "has_sand_bedding": True, "has_measuring_stick": True,
         "has_address_sheet": True, "address": "Salzachuferstraße 12"},
        {"id": "p2", "filename": "IMG_0002.jpg", "category": 2,
         "has_duplicate": False, "depth_cm": None, "depth_confidence": None,
         "has_trench": True, "has_trench_confidence": 88,
         "has_sand_bedding": True, "has_measuring_stick": False,
         "has_address_sheet": False, "address": None},
        {"id": "p3", "filename": "IMG_0003.jpg", "category": 3,
         "has_duplicate": False, "depth_cm": 72.5, "depth_confidence": 75,
         "has_trench": False, "has_trench_confidence": 80,
         "has_sand_bedding": False, "has_measuring_stick": True,
         "has_address_sheet": True, "address": "Mühlweg 3"},
        {"id": "p4", "filename": "IMG_0004.jpg", "category": 4,
         "has_duplicate": True, "depth_cm": None, "depth_confidence": None,
         "has_trench": False, "has_trench_confidence": None,
         "has_sand_bedding": None, "has_measuring_stick": False,
         "has_address_sheet": False, "address": None},
    ],
}


def test_build_pdf_writes_valid_file(tmp_path: Path) -> None:
    out = tmp_path / "out.pdf"
    build_pdf(
        out, FIXTURE,
        meta={
            "project_id": "CLP20417A-P1-B00",
            "contractor": "Example Contractor Y",
            "region": "Carinthia",
            "submission_date": "12 May 2026",
            "audit_date": "16 May 2026",
            "audited_by": "Ohsome Compliance",
        },
        length_m=1840.0,
    )
    assert out.exists()
    head = out.read_bytes()[:5]
    assert head == b"%PDF-", f"unexpected file header: {head!r}"


if __name__ == "__main__":
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        test_build_pdf_writes_valid_file(Path(d))
        print("OK")
