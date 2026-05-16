"""PNG renderer for the PDF report's map section.

Mirrors the frontend MapView coloring: each trench segment is colored by
the best category of photos within COVERAGE_RADIUS_M (green > yellow >
red > missing). Photo markers themselves are drawn on top in their own
category color.
"""

from __future__ import annotations

import io
import math
from pathlib import Path

import staticmaps

from app.geo import load_trenches

_TRENCH_GEOJSON = (
    Path(__file__).resolve().parent.parent.parent
    / "public/geojson/CLP20417A-P1-B00_Trenches.geojson"
)

COVERAGE_RADIUS_M = 80.0
_EARTH_RADIUS_M = 6_371_000.0

# Status color for trench polylines (matches frontend QC_COLORS).
_TRENCH_STATUS_COLORS = {
    "green":   staticmaps.Color(34, 197, 94),
    "yellow":  staticmaps.Color(245, 158, 11),
    "red":     staticmaps.Color(239, 68, 68),
    "missing": staticmaps.Color(148, 163, 184, 140),
}

# Category color for photo markers.
_CATEGORY_COLORS = {
    1: staticmaps.Color(34, 197, 94),
    2: staticmaps.Color(245, 158, 11),
    3: staticmaps.Color(239, 68, 68),
    4: staticmaps.Color(75, 85, 99),
}

# Map integer category (1/2/3/4) to trench-status priority (green/yellow/red/none).
_CAT_TO_STATUS = {1: "green", 2: "yellow", 3: "red"}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _min_dist_to_linestring(
    lat: float, lon: float, coords: list[tuple[float, float]]
) -> float:
    # coords are (lon, lat) GeoJSON pairs. Approximate by min distance to
    # vertices + midpoints — same shortcut the frontend uses.
    best = float("inf")
    for i, (lo, la) in enumerate(coords):
        d = _haversine_m(lat, lon, la, lo)
        if d < best:
            best = d
        if i + 1 < len(coords):
            mlo = (lo + coords[i + 1][0]) / 2
            mla = (la + coords[i + 1][1]) / 2
            d = _haversine_m(lat, lon, mla, mlo)
            if d < best:
                best = d
    return best


def _segment_status(coords: list[tuple[float, float]], geo_photos: list[dict]) -> str:
    lats = [c[1] for c in coords]
    lons = [c[0] for c in coords]
    pad = 0.001
    min_lat, max_lat = min(lats) - pad, max(lats) + pad
    min_lon, max_lon = min(lons) - pad, max(lons) + pad

    nearby_cats: set[str] = set()
    for p in geo_photos:
        lat = p["latitude"]
        lon = p["longitude"]
        if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
            continue
        if _min_dist_to_linestring(lat, lon, coords) > COVERAGE_RADIUS_M:
            continue
        status = _CAT_TO_STATUS.get(p["category"])
        if status:
            nearby_cats.add(status)

    if "green" in nearby_cats:
        return "green"
    if "yellow" in nearby_cats:
        return "yellow"
    if "red" in nearby_cats:
        return "red"
    return "missing"


def build_map_png(db_data: dict, width: int = 1600, height: int = 1000) -> bytes:
    ctx = staticmaps.Context()
    ctx.set_tile_provider(staticmaps.tile_provider_OSM)

    geo_photos = [
        p for p in (db_data.get("photos") or [])
        if p.get("latitude") is not None and p.get("longitude") is not None
    ]

    for seg in load_trenches(_TRENCH_GEOJSON):
        status = _segment_status(seg.coords, geo_photos)
        color = _TRENCH_STATUS_COLORS[status]
        # Brighten and thicken colored segments so they read on the small PDF
        # map; grey "missing" segments stay thin so they don't fight for
        # attention.
        width_px = 3 if status != "missing" else 2
        latlon = [staticmaps.create_latlng(la, lo) for lo, la in seg.coords]
        ctx.add_object(staticmaps.Line(latlon, color=color, width=width_px))

    for p in geo_photos:
        cat = int(p.get("category") or 4)
        color = _CATEGORY_COLORS.get(cat, _CATEGORY_COLORS[4])
        ctx.add_object(
            staticmaps.Marker(
                staticmaps.create_latlng(float(p["latitude"]), float(p["longitude"])),
                color=color,
                size=10,
            )
        )

    image = ctx.render_pillow(width, height)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()
