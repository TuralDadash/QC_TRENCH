"""Duplicate clustering across photos.

Two photos are linked if either:
  - pHash Hamming distance <= STRICT_HAMMING (near-identical pixels), or
  - pHash Hamming distance <= LOOSE_HAMMING AND GPS within GPS_PROX_M
    AND timestamps within TIME_PROX_S (same scene, slight crop / re-encode).

Union-find produces clusters; the first photo in input order is the "original",
the rest are flagged as duplicates pointing back to it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from PIL import Image

STRICT_HAMMING = 6
LOOSE_HAMMING = 12
GPS_PROX_M = 5.0
TIME_PROX_S = 60.0

EARTH_RADIUS_M = 6_371_000.0


@dataclass
class PhotoFingerprint:
    id: str
    phash: int  # 256-bit integer
    lat: Optional[float] = None
    lon: Optional[float] = None
    timestamp: Optional[datetime] = None
    address: Optional[str] = None  # paper-note address text, for metadata-only clustering


def average_phash(image: Image.Image, size: int = 16) -> int:
    """16x16 average hash -> 256-bit int."""
    gray = image.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    avg = sum(pixels) / len(pixels)
    bits = 0
    for p in pixels:
        bits = (bits << 1) | (1 if p >= avg else 0)
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlamb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlamb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _gps_close(p: PhotoFingerprint, q: PhotoFingerprint) -> bool:
    if None in (p.lat, p.lon, q.lat, q.lon):
        return False
    return _haversine_m(p.lat, p.lon, q.lat, q.lon) < GPS_PROX_M


def _time_close(p: PhotoFingerprint, q: PhotoFingerprint) -> bool:
    if p.timestamp is None or q.timestamp is None:
        return False
    return abs((p.timestamp - q.timestamp).total_seconds()) < TIME_PROX_S


def _normalize_address(text: Optional[str]) -> str:
    if not text:
        return ""
    return " ".join(text.lower().split())


def _address_match(p: PhotoFingerprint, q: PhotoFingerprint) -> bool:
    a, b = _normalize_address(p.address), _normalize_address(q.address)
    return bool(a) and a == b


def find_clusters(photos: list[PhotoFingerprint]) -> dict[str, Optional[str]]:
    """Return mapping photo_id -> duplicate_of (or None for originals)."""
    n = len(photos)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri == rj:
            return
        # keep the lower index as root so the original (first seen) wins
        if ri < rj:
            parent[rj] = ri
        else:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            h = hamming(photos[i].phash, photos[j].phash)
            if h <= STRICT_HAMMING:
                union(i, j)
                continue
            if (
                h <= LOOSE_HAMMING
                and _gps_close(photos[i], photos[j])
                and _time_close(photos[i], photos[j])
            ):
                union(i, j)

    result: dict[str, Optional[str]] = {}
    for i, p in enumerate(photos):
        root = find(i)
        if root == i:
            result[p.id] = None
        else:
            result[p.id] = photos[root].id
    return result


def find_clusters_metadata(photos: list[PhotoFingerprint]) -> dict[str, Optional[str]]:
    """Metadata-only clustering. Rule:
      1. Both have GPS within GPS_PROX_M -> duplicate.
      2. Else both have timestamps within TIME_PROX_S AND addresses match
         (normalized exact) -> duplicate.
    Pixel similarity (pHash) is ignored. First photo in input order wins as root.
    """
    n = len(photos)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri == rj:
            return
        if ri < rj:
            parent[rj] = ri
        else:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            if _gps_close(photos[i], photos[j]):
                union(i, j)
                continue
            if _time_close(photos[i], photos[j]) and _address_match(photos[i], photos[j]):
                union(i, j)

    result: dict[str, Optional[str]] = {}
    for i, p in enumerate(photos):
        root = find(i)
        result[p.id] = None if root == i else photos[root].id
    return result
