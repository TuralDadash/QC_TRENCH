"""Pluggable AI-generated image detector.

Default implementation is a no-op: detect() returns None and the pipeline relies
on Gemini's own is_likely_ai_generated flag. To plug in a real detector, set the
env var AI_DETECTOR_MODEL_PATH to a model file and extend load_detector() below.
"""

from __future__ import annotations

import os
from typing import Optional, TypedDict


class DetectionResult(TypedDict):
    is_ai_generated: bool
    confidence: float


_detector_cache: dict[str, object] = {}


def load_detector():
    """Return a callable (image_bytes) -> DetectionResult, or None if disabled."""
    model_path = os.environ.get("AI_DETECTOR_MODEL_PATH")
    if not model_path:
        return None
    if "loaded" in _detector_cache:
        return _detector_cache["loaded"]
    # TODO: load pretrained ONNX / transformers model from model_path
    # Example skeleton:
    #   import onnxruntime as ort
    #   session = ort.InferenceSession(model_path)
    #   def _run(image_bytes: bytes) -> DetectionResult:
    #       arr = preprocess(image_bytes)
    #       prob = session.run(None, {"input": arr})[0][0][0]
    #       return {"is_ai_generated": prob > 0.5, "confidence": float(prob)}
    #   _detector_cache["loaded"] = _run
    #   return _run
    return None


def detect(image_bytes: bytes) -> Optional[DetectionResult]:
    runner = load_detector()
    if runner is None:
        return None
    return runner(image_bytes)
