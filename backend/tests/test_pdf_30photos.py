"""Render the customer PDF + appendix with a 30-photo fixture.

Bypasses the DB; feeds the renderers a synthetic db_data dict that matches
the production smoke shape (12/8/5/5 across cat 1-4).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pdf_render import build_pdf
from app.pdf_appendix import build_appendix_pdf


def _photo(i: int, cat: int) -> dict:
    base = {
        "id": f"p{i:02d}",
        "filename": f"IMG_{i:04d}.jpg",
        "category": cat,
        "has_duplicate": False,
        "has_gps": True,
        "has_tape": False,
        "depth_cm": None,
        "depth_confidence": None,
        "has_trench": None,
        "has_trench_confidence": None,
        "has_sand_bedding": None,
        "has_measuring_stick": False,
        "has_address_sheet": False,
        "address": None,
    }
    if cat == 1:
        base.update(
            depth_cm=60.0 + (i % 40),
            depth_confidence=85 + (i % 10),
            has_trench=True, has_trench_confidence=92,
            has_sand_bedding=True, has_measuring_stick=True,
            has_address_sheet=(i % 3 == 0),
            address=f"Salzachuferstraße {i}" if i % 3 == 0 else None,
        )
    elif cat == 2:
        base.update(
            has_trench=True, has_trench_confidence=88,
            has_sand_bedding=True, has_measuring_stick=False,
        )
    elif cat == 3:
        base.update(
            depth_cm=55.0 + (i % 35),
            depth_confidence=78 + (i % 8),
            has_trench=False, has_trench_confidence=70,
            has_measuring_stick=True,
            has_address_sheet=(i % 4 == 0),
            address=f"Mühlweg {i}" if i % 4 == 0 else None,
        )
    elif cat == 4:
        bucket = i % 3
        if bucket == 0:
            base.update(has_duplicate=True, has_trench=True, has_trench_confidence=80)
        elif bucket == 1:
            base.update(has_trench=False, depth_cm=None, has_tape=True)
        else:
            base.update(has_trench=False, depth_cm=None)
    return base


DEFAULT_SPLIT = ((1, 20), (2, 13), (3, 9), (4, 8))


def build_fixture(split: tuple = DEFAULT_SPLIT) -> dict:
    photos: list[dict] = []
    idx = 1
    for cat, n in split:
        for _ in range(n):
            photos.append(_photo(idx, cat))
            idx += 1
    addresses = [
        {"photo_id": p["id"], "filename": p["filename"], "address": p["address"]}
        for p in photos if p["address"]
    ]
    counts = {cat: n for cat, n in split}
    return {
        "total_photos": sum(counts.values()),
        "category_counts": counts,
        "cat4_breakdown": {
            "duplicate": sum(1 for p in photos if p["category"] == 4 and p["has_duplicate"]),
            "gps_inconsistent": None,
            "warning_tape_only": sum(
                1 for p in photos
                if p["category"] == 4 and not p["has_duplicate"]
                and p.get("has_tape") is True
                and p.get("has_trench") is not True and p.get("depth_cm") is None
            ),
            "ai_generated": None,
        },
        "addresses": addresses,
        "photos": photos,
    }



META = {
    "project_id": "CLP20417A-P1-B00",
    "contractor": "Example Contractor Y",
    "region": "Carinthia",
    "submission_date": "12 May 2026",
    "audit_date": "16 May 2026",
    "audited_by": "Ohsome Compliance",
}


def render(out_dir: Path, split: tuple = DEFAULT_SPLIT, length_m: float = 250.0) -> tuple[Path, Path]:
    data = build_fixture(split)
    n = data["total_photos"]
    report = out_dir / f"trench-audit_{n}.pdf"
    appendix = out_dir / f"trench-audit-appendix_{n}.pdf"
    build_pdf(report, data, meta=META, length_m=length_m)
    build_appendix_pdf(appendix, data, meta=META)
    return report, appendix


def test_render_default() -> None:
    with tempfile.TemporaryDirectory() as d:
        r, a = render(Path(d))
        assert r.exists() and a.exists()
        assert r.read_bytes()[:5] == b"%PDF-"
        assert a.read_bytes()[:5] == b"%PDF-"


if __name__ == "__main__":
    import sys
    total = int(sys.argv[1]) if len(sys.argv) > 1 else sum(n for _, n in DEFAULT_SPLIT)
    base = total / 30
    split = tuple((cat, max(1, round(n * base * 30 / 30)))
                  for cat, n in ((1, 20), (2, 13), (3, 9), (4, 8)))
    scaled = []
    remaining = total
    for i, (cat, _) in enumerate(split):
        share = {1: 0.40, 2: 0.27, 3: 0.18, 4: 0.15}[cat]
        n = round(total * share) if i < 3 else remaining
        scaled.append((cat, n))
        remaining -= n
    out = Path(f"/tmp/trench_pdf_{total}")
    out.mkdir(exist_ok=True)
    r, a = render(out, split=tuple(scaled), length_m=total * 5.0)
    print(f"split: {scaled}  length_m={total*5.0}")
    print(f"OK  report:   {r}  ({r.stat().st_size:,} bytes)")
    print(f"OK  appendix: {a}  ({a.stat().st_size:,} bytes)")
