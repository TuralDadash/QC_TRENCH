"""Analyze an image with Gemini given a text prompt."""

import argparse
import os
import sys
from pathlib import Path

from google import genai
from google.genai import types
from pydantic import BaseModel


DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_PROMPT_FILE = Path(__file__).parent / "prompts" / "default.txt"


class TrenchAnalysis(BaseModel):
    has_trench: bool
    has_vertical_measuring_stick: bool
    has_address_sheet: bool
    address: str | None
    has_sand_bedding: bool


def guess_mime_type(path: Path) -> str:
    suffix = path.suffix.lower()
    mapping = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".heic": "image/heic",
        ".heif": "image/heif",
    }
    if suffix not in mapping:
        raise ValueError(f"Unsupported image extension: {suffix}")
    return mapping[suffix]


def analyze_image(image_path: Path, prompt: str, model: str) -> str:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment. "
            "Get a key at https://aistudio.google.com/apikey"
        )

    client = genai.Client(api_key=api_key)

    image_bytes = image_path.read_bytes()
    image_part = types.Part.from_bytes(
        data=image_bytes,
        mime_type=guess_mime_type(image_path),
    )

    response = client.models.generate_content(
        model=model,
        contents=[prompt, image_part],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=TrenchAnalysis,
        ),
    )
    return response.text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Path to the image file")
    prompt_group = parser.add_mutually_exclusive_group()
    prompt_group.add_argument(
        "-f",
        "--prompt-file",
        type=Path,
        default=DEFAULT_PROMPT_FILE,
        help=f"Path to a file containing the prompt (default: {DEFAULT_PROMPT_FILE.relative_to(Path(__file__).parent)})",
    )
    prompt_group.add_argument(
        "-p",
        "--prompt",
        help="Inline prompt text (overrides --prompt-file)",
    )
    parser.add_argument(
        "-m",
        "--model",
        default=DEFAULT_MODEL,
        help=f"Gemini model to use (default: {DEFAULT_MODEL})",
    )
    args = parser.parse_args()

    if not args.image.is_file():
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    if args.prompt is not None:
        prompt = args.prompt
    else:
        if not args.prompt_file.is_file():
            print(f"Prompt file not found: {args.prompt_file}", file=sys.stderr)
            return 1
        prompt = args.prompt_file.read_text().strip()
        if not prompt:
            print(f"Prompt file is empty: {args.prompt_file}", file=sys.stderr)
            return 1

    try:
        result = analyze_image(args.image, prompt, args.model)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
