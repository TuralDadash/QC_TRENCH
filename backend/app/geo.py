"""GeoJSON trench loader and photo-to-segment projection.

A LineString segment is a chain of WGS84 points. Each photo gets projected
perpendicularly onto the nearest internal sub-segment; the smallest cross-track
distance wins. Cutoff (default 15m) marks photos as off-route.
"""

from __future__ import annotations

import json
import math
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

EARTH_RADIUS_M = 6_371_000.0
DEFAULT_CUTOFF_M = 15.0
DEFAULT_GRID_M = 5.0


@dataclass
class Segment:
    id: str
    coords: list[tuple[float, float]]  # list of (lon, lat) — GeoJSON order
    properties: dict = field(default_factory=dict)

    @property
    def length_m(self) -> float:
        return sum(
            _haversine_m(a[1], a[0], b[1], b[0])
            for a, b in zip(self.coords, self.coords[1:])
        )


@dataclass
class Projection:
    segment_id: str
    distance_m: float
    position_along_segment_m: float
    on_route: bool


def load_trenches(path: str | Path) -> list[Segment]:
    path = Path(path)
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as zf:
            inner = next(n for n in zf.namelist() if n.endswith(".geojson"))
            with zf.open(inner) as fh:
                data = json.load(fh)
    else:
        with open(path) as fh:
            data = json.load(fh)
    return list(_iter_segments(data))


def total_route_length_m(path: str | Path) -> float:
    return sum(seg.length_m for seg in load_trenches(path))


def _iter_segments(geojson: dict) -> Iterable[Segment]:
    features = geojson.get("features", [])
    for i, feat in enumerate(features):
        geom = feat.get("geometry") or {}
        props = feat.get("properties") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates") or []
        seg_id = (
            props.get("externalID")
            or props.get("name")
            or feat.get("id")
            or f"SEG-{i:05d}"
        )
        if gtype == "LineString" and len(coords) >= 2:
            yield Segment(id=str(seg_id), coords=[tuple(c[:2]) for c in coords], properties=props)
        elif gtype == "MultiLineString":
            for j, line in enumerate(coords):
                if len(line) >= 2:
                    yield Segment(
                        id=f"{seg_id}#{j}",
                        coords=[tuple(c[:2]) for c in line],
                        properties=props,
                    )


def project_point(
    lat: float,
    lon: float,
    segments: list[Segment],
    cutoff_m: float = DEFAULT_CUTOFF_M,
) -> Optional[Projection]:
    """Return nearest segment projection, or None if no segment within cutoff."""
    best: Optional[Projection] = None
    for seg in segments:
        proj = _project_on_segment(lat, lon, seg)
        if proj is None:
            continue
        if best is None or proj.distance_m < best.distance_m:
            best = proj
    if best is None:
        return None
    best.on_route = best.distance_m <= cutoff_m
    return best


def _project_on_segment(lat: float, lon: float, seg: Segment) -> Optional[Projection]:
    """Walk the polyline, project onto each sub-segment, keep minimum."""
    best_d = math.inf
    best_along = 0.0
    cumulative = 0.0
    for (lon_a, lat_a), (lon_b, lat_b) in zip(seg.coords, seg.coords[1:]):
        d, along_fraction, sub_len = _perp_distance_local(lat, lon, lat_a, lon_a, lat_b, lon_b)
        if d < best_d:
            best_d = d
            best_along = cumulative + along_fraction * sub_len
        cumulative += sub_len
    if best_d is math.inf:
        return None
    return Projection(
        segment_id=seg.id,
        distance_m=best_d,
        position_along_segment_m=best_along,
        on_route=False,  # caller fills in
    )


def _perp_distance_local(
    lat: float, lon: float,
    lat_a: float, lon_a: float,
    lat_b: float, lon_b: float,
) -> tuple[float, float, float]:
    """Local-tangent-plane projection of P onto AB. Returns (perp_dist_m, t, ab_len_m).

    t in [0,1] clamped — perp_dist measured to the clamped foot.
    """
    lat0 = math.radians((lat_a + lat_b) / 2.0)
    mx = math.cos(lat0) * (math.pi / 180.0) * EARTH_RADIUS_M
    my = (math.pi / 180.0) * EARTH_RADIUS_M
    ax, ay = lon_a * mx, lat_a * my
    bx, by = lon_b * mx, lat_b * my
    px, py = lon * mx, lat * my
    abx, aby = bx - ax, by - ay
    ab_len_sq = abx * abx + aby * aby
    ab_len = math.sqrt(ab_len_sq)
    if ab_len_sq == 0.0:
        d = math.hypot(px - ax, py - ay)
        return d, 0.0, 0.0
    t = ((px - ax) * abx + (py - ay) * aby) / ab_len_sq
    t_clamped = max(0.0, min(1.0, t))
    fx = ax + t_clamped * abx
    fy = ay + t_clamped * aby
    d = math.hypot(px - fx, py - fy)
    return d, t_clamped, ab_len


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlamb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlamb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


@dataclass
class GridCell:
    segment_id: str
    bin_start_m: float
    bin_end_m: float
    photo_ids: list[str] = field(default_factory=list)
    categories: dict[str, int] = field(default_factory=dict)  # green/yellow/red counts


def coverage_along_route(
    segments: list[Segment],
    photos: list[dict],
    step_m: float = DEFAULT_GRID_M,
) -> dict[str, list[GridCell]]:
    """Bin photos into step_m cells per segment.

    Each photo dict must carry: id, category, segment_id, segment_position_m.
    Returns mapping segment_id -> list[GridCell].
    """
    cells_by_seg: dict[str, list[GridCell]] = {}
    for seg in segments:
        length = max(seg.length_m, step_m)  # at least one bin
        n_bins = max(1, math.ceil(length / step_m))
        cells_by_seg[seg.id] = [
            GridCell(
                segment_id=seg.id,
                bin_start_m=i * step_m,
                bin_end_m=min((i + 1) * step_m, seg.length_m),
            )
            for i in range(n_bins)
        ]
    for p in photos:
        seg_id = p.get("segment_id")
        if seg_id is None or seg_id not in cells_by_seg:
            continue
        pos = float(p.get("segment_position_m", 0.0))
        bin_idx = min(int(pos // step_m), len(cells_by_seg[seg_id]) - 1)
        cell = cells_by_seg[seg_id][bin_idx]
        cell.photo_ids.append(p["id"])
        cat = p.get("category", "cat4")
        cell.categories[cat] = cell.categories.get(cat, 0) + 1
    return cells_by_seg
