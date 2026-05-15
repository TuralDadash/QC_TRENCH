"""Gemini Vision wrapper for per-photo signal extraction.

One call per photo returns a structured PhotoAssessment covering:
  - duct visibility, depth/ruler reading, sand bedding, pipe end seals
  - burnt-in metadata OCR (GPS, timestamp) + address label OCR
  - privacy flags + AI-generated suspicion

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


class AddressLabel(BaseModel):
    found: bool = False
    text: Optional[str] = None
    confidence: float = 0.0


class PrivacyFlags(BaseModel):
    faces_visible: bool = False
    license_plates_visible: bool = False


class PipeEndSeals(BaseModel):
    status: Literal["sealed", "unsealed", "not_visible"] = "not_visible"
    confidence: float = 0.0


class PhotoAssessment(BaseModel):
    is_construction_photo: bool = False
    is_likely_ai_generated: bool = False
    overall_confidence: float = 0.0
    duct: DuctSignal = Field(default_factory=DuctSignal)
    depth: DepthSignal = Field(default_factory=DepthSignal)
    sand_bedding: SandBeddingSignal = Field(default_factory=SandBeddingSignal)
    burnt_in_metadata: BurntInMetadata = Field(default_factory=BurntInMetadata)
    address_label: AddressLabel = Field(default_factory=AddressLabel)
    privacy_flags: PrivacyFlags = Field(default_factory=PrivacyFlags)
    pipe_end_seals: PipeEndSeals = Field(default_factory=PipeEndSeals)


_PROMPT = """You are reviewing a documentation photo from a fiber-optic trench construction site.
Inspect the image and fill the structured schema. Be conservative: when a signal is
not clearly readable, mark uncertain / not visible / confidence low.

Definitions:
- duct: a plastic conduit (often black or grey corrugated tube) carrying fiber cables.
  Yellow cables are typically gas/electric, NOT fiber — set duct.visible=false unless
  you can identify a fiber duct. Other utility pipes can coexist in the trench.
- depth measurement: a folding ruler or measuring tape lying in the trench, used to
  document trench depth. If visible, read the depth in centimeters. Plausible range
  for fiber trenches is 70-120 cm. If you cannot read it confidently, set uncertain=true
  and report depth_range_cm with your best lower/upper bounds.
- sand bedding: fine light-colored sand layer around the duct. Distinguish from
  dark soil. Shadows can make sand look darker — if ambiguous, use status="uncertain".
- burnt_in_metadata: many photos have white text overlaid at the bottom/edge with
  GPS coordinates and timestamp. Extract them. raw_text is the literal overlay text.
- address_label: occasionally a white paper with handwritten or printed address is
  placed in the trench. Extract its full text if visible.
- is_likely_ai_generated: flag if the image looks synthetic, has impossible physics,
  watermark from a known generator, or unnatural texture artifacts.

Return only the structured JSON. Do not include any prose outside the schema.
"""


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
