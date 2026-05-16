"""CLI entry point for the trench-photo audit.

Usage:
    python scripts/run_batch.py \
        --photos "<local-photo-dir>" \
        --route  "../CLP20417A-P1-B00__.../CLP20417A-P1-B00_Trenches_geojson.zip" \
        --out    results.json \
        [--limit 20] [--concurrency 8]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipeline import run

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def collect_photos(root: Path, limit: int | None) -> list[Path]:
    if root.is_file():
        return [root]
    photos = sorted(
        p for p in root.rglob("*") if p.suffix.lower() in PHOTO_EXTS and p.is_file()
    )
    if limit:
        photos = photos[:limit]
    return photos


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", required=True, type=Path, help="Photo file or directory")
    parser.add_argument("--route", required=True, type=Path, help="Trenches GeoJSON or zip")
    parser.add_argument("--out", required=True, type=Path, help="Output JSON path")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    photos = collect_photos(args.photos, args.limit)
    if not photos:
        print(f"no photos found under {args.photos}", file=sys.stderr)
        return 1
    print(f"processing {len(photos)} photos with concurrency={args.concurrency}", file=sys.stderr)

    t0 = time.time()
    result = run(photos, args.route, concurrency=args.concurrency)
    elapsed = time.time() - t0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False))

    agg = result["aggregates"]
    print(
        f"done in {elapsed:.1f}s. "
        f"photos: {agg['total_photos']} "
        f"({agg['category_counts']}), "
        f"segments: {agg['segment_status_counts']}",
        file=sys.stderr,
    )
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
