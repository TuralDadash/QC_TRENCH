"""Print a human-readable diff between pHash and metadata-only duplicate
clusterings, given an audit JSON produced by run_batch.py or POST /api/audit.

Usage: python scripts/compare_duplicates.py <audit.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _by_id(photos: list[dict]) -> dict[str, dict]:
    return {p["id"]: p for p in photos}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: compare_duplicates.py <audit.json>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    photos = data.get("photos", [])
    comp = data.get("duplicate_comparison")
    if not comp:
        print("No duplicate_comparison block in this JSON.", file=sys.stderr)
        return 1

    idx = _by_id(photos)

    def label(pid: str) -> str:
        p = idx.get(pid) or {}
        return f"{pid} ({p.get('filename', '?')})"

    print(f"Total photos: {len(photos)}")
    print(f"pHash duplicates:     {comp['phash_duplicate_count']}")
    print(f"Metadata duplicates:  {comp['metadata_duplicate_count']}")
    print(f"Cluster Jaccard:      {comp['cluster_jaccard']}")
    print()
    print(f"Agree (both methods, same parent): {len(comp['agree_both'])}")
    for pid in comp["agree_both"]:
        p = idx.get(pid) or {}
        print(f"  - {label(pid)} -> {label(p.get('duplicate_of_phash', ''))}")
    print()
    print(f"pHash only:    {len(comp['phash_only'])}")
    for pid in comp["phash_only"]:
        p = idx.get(pid) or {}
        print(f"  - {label(pid)} -> {label(p.get('duplicate_of_phash', ''))}")
    print()
    print(f"Metadata only: {len(comp['metadata_only'])}")
    for pid in comp["metadata_only"]:
        p = idx.get(pid) or {}
        print(f"  - {label(pid)} -> {label(p.get('duplicate_of_metadata', ''))}")
    print()
    print(f"Disagree (different parent): {len(comp['disagree_parent'])}")
    for pid in comp["disagree_parent"]:
        p = idx.get(pid) or {}
        print(
            f"  - {label(pid)}: pHash->{label(p.get('duplicate_of_phash', ''))}"
            f"  meta->{label(p.get('duplicate_of_metadata', ''))}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
