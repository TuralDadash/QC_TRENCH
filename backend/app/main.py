from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Load backend/.env before importing modules that read env at import time
# (e.g. vlm.DEFAULT_MODEL). dotenv leaves pre-existing env vars untouched,
# so docker / shell exports still win.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.pipeline import run as run_pipeline
from app.geo import total_route_length_m
from app import db as report_db
from app import report as report_mod

# Trench GeoJSON shipped with the repo (also used by the frontend map).
# Total length is constant per project so we cache it after first read.
_TRENCH_GEOJSON = (
    Path(__file__).resolve().parent.parent.parent
    / "public/geojson/CLP20417A-P1-B00_Trenches.geojson"
)
_route_length_cache: float | None = None


def _default_route_length_m() -> float | None:
    global _route_length_cache
    if _route_length_cache is not None:
        return _route_length_cache
    try:
        _route_length_cache = total_route_length_m(_TRENCH_GEOJSON)
    except Exception:
        return None
    return _route_length_cache

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"

MAX_FILES = 200
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_ROUTE_BYTES = 50 * 1024 * 1024

app = FastAPI(
    title="Fiber Trench QC",
    description="Hackathon backend: GeoJSON route + photos -> per-segment green/yellow/red.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/audit")
async def audit(
    files: List[UploadFile] = File(...),
    route: Optional[UploadFile] = File(None),
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one photo.")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Up to {MAX_FILES} photos per request.")
    if route is None:
        raise HTTPException(status_code=400, detail="Upload a GeoJSON or zipped GeoJSON route.")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        photo_paths: list[Path] = []
        for file in files:
            data = await file.read()
            if not data:
                continue
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=400, detail=f"{file.filename} larger than 15MB.")
            dest = tmp / (file.filename or f"photo_{len(photo_paths)}.jpg")
            dest.write_bytes(data)
            photo_paths.append(dest)
        if not photo_paths:
            raise HTTPException(status_code=400, detail="No readable photos uploaded.")

        route_data = await route.read()
        if len(route_data) > MAX_ROUTE_BYTES:
            raise HTTPException(status_code=400, detail="Route file too large.")
        suffix = ".zip" if (route.filename or "").lower().endswith(".zip") else ".geojson"
        route_path = tmp / f"route{suffix}"
        route_path.write_bytes(route_data)

        return run_pipeline(photo_paths, route_path, concurrency=4)


MOCK_META_DEFAULTS = {
    "project_id": "ID Out of Database",
    "project_subtitle": "Trenches Picture Review for Project X by Construction company Y",
    "contractor": "Example Contractor Y",
    "region": "Carinthia",
    "submission_date": "12 May 2026",
    "audit_date": "16 May 2026",
    "audited_by": "Ohsome Compliance",
}


@app.post("/api/report/pdf")
def generate_pdf_report(payload: dict = Body(default={})) -> FileResponse:
    if len(str(payload)) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Payload too large.")

    project = payload.get("project")
    meta = {**MOCK_META_DEFAULTS, **(payload.get("meta") or {})}
    length_m = payload.get("length_m")
    if length_m is None:
        length_m = _default_route_length_m()
    cat4_overrides = payload.get("cat4_breakdown") or {}

    try:
        db_data = report_db.fetch_report_data(project=project)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB read failed: {exc}") from exc

    tmp = Path(tempfile.mkstemp(suffix=".pdf", prefix="trench-audit-")[1])
    report_mod.to_pdf(
        db_data, tmp,
        meta=meta, length_m=length_m, cat4_overrides=cat4_overrides,
    )
    return FileResponse(
        tmp, media_type="application/pdf", filename="trench-audit.pdf",
    )


@app.post("/api/report/appendix.pdf")
def generate_appendix_pdf(payload: dict = Body(default={})) -> FileResponse:
    from app.pdf_appendix import build_appendix_pdf

    project = payload.get("project")
    meta = {**MOCK_META_DEFAULTS, **(payload.get("meta") or {})}
    try:
        db_data = report_db.fetch_report_data(project=project)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB read failed: {exc}") from exc

    tmp = Path(tempfile.mkstemp(suffix=".pdf", prefix="trench-appendix-")[1])
    build_appendix_pdf(tmp, db_data, meta=meta)
    return FileResponse(
        tmp, media_type="application/pdf", filename="trench-audit-appendix.pdf",
    )
