"""Gemini Vision wrapper for per-photo signal extraction.

One call per photo returns a structured PhotoAssessment covering:
  - duct visibility, depth/ruler reading, sand bedding
  - burnt-in metadata OCR (GPS, timestamp) + address-label OCR

If GEMINI_API_KEY is unset or the SDK is missing, assess() returns a deterministic
empty PhotoAssessment (all confidences 0). This keeps the rest of the pipeline
runnable for smoke tests and dry runs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

DEFAULT_MODEL = os.environ.get("GEMINI_VLM_MODEL", "gemini-2.5-flash")


class DuctSignal(BaseModel):
    visible: bool = False
    confidence: float = 0.0
    notes: str = ""


class DepthSignal(BaseModel):
    ruler_visible: bool = False
    depth_value_cm: Optional[float] = None
    depth_range_cm: Optional[list[float]] = None  # [low, high]
    uncertain: bool = True
    confidence: float = 0.0
    notes: str = ""


class SandBeddingSignal(BaseModel):
    status: Literal["sand", "uncertain", "not_sand"] = "uncertain"
    confidence: float = 0.0


class BurntInMetadata(BaseModel):
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    timestamp_iso: Optional[str] = None
    raw_text: str = ""
    confidence: float = 0.0


class AddressLabel(BaseModel):
    found: bool = False
    paper_note_count: int = 0
    text: Optional[str] = None
    confidence: float = 0.0


class PhotoAssessment(BaseModel):
    is_construction_photo: bool = False
    is_construction_photo_confidence: float = 0.0
    overall_confidence: float = 0.0
    duct: DuctSignal = Field(default_factory=DuctSignal)
    depth: DepthSignal = Field(default_factory=DepthSignal)
    sand_bedding: SandBeddingSignal = Field(default_factory=SandBeddingSignal)
    burnt_in_metadata: BurntInMetadata = Field(default_factory=BurntInMetadata)
    address_label: AddressLabel = Field(default_factory=AddressLabel)


_DEFAULT_PROMPT_FILE = Path(__file__).parent / "prompts" / "default.txt"


def _load_prompt() -> str:
    override = os.environ.get("TRENCH_PROMPT_FILE")
    path = Path(override) if override else _DEFAULT_PROMPT_FILE
    return path.read_text(encoding="utf-8")


_PROMPT = _load_prompt()


def _empty_assessment() -> PhotoAssessment:
    return PhotoAssessment()


def assess(image_bytes: bytes, mime_type: str = "image/jpeg") -> PhotoAssessment:
    """Call Gemini on a single image. Returns PhotoAssessment.

    Falls back to an empty assessment when no API key is set or SDK missing.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return _empty_assessment()
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return _empty_assessment()

    client = _get_client(api_key)
    response = client.models.generate_content(
        model=DEFAULT_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            _PROMPT,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=PhotoAssessment.model_json_schema(),
            temperature=0.1,
        ),
    )
    try:
        payload = json.loads(response.text)
        return PhotoAssessment.model_validate(payload)
    except Exception:
        return _empty_assessment()


_client_cache: dict[str, object] = {}


def _get_client(api_key: str):
    if "client" not in _client_cache:
        from google import genai
        _client_cache["client"] = genai.Client(api_key=api_key)
    return _client_cache["client"]


def assess_file(path: str | Path) -> PhotoAssessment:
    path = Path(path)
    suffix = path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(suffix, "image/jpeg")
    return assess(path.read_bytes(), mime_type=mime)
