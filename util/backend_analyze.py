"""Run the 'backend' (alternative) VLM path on a single image and print JSON.

This is the benchmarking counterpart to analyze_image.py: it invokes the
trench-QC backend's per-photo VLM assessment (backend/app/vlm.py) so the web
app can compare it against the default Gemini path. Output is the
PhotoAssessment schema as JSON on stdout.
"""

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

import json  # noqa: E402

from app import vlm  # noqa: E402
from app.classify import classify_photo  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: backend_analyze.py <image>", file=sys.stderr)
        return 2

    image = Path(sys.argv[1])
    if not image.is_file():
        print(f"Image not found: {image}", file=sys.stderr)
        return 1

    if not os.environ.get("GEMINI_API_KEY"):
        print(
            "Set GEMINI_API_KEY in your environment for the backend VLM path.",
            file=sys.stderr,
        )
        return 1

    try:
        assessment = vlm.assess_file(image)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    classification = classify_photo(assessment)
    out = assessment.model_dump()
    out["category"] = classification.category
    out["reason"] = classification.reason
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
