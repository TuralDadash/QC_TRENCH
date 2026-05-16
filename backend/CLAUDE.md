# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project

**Fiber Trench QC** is a hackathon backend for the ÖGIG / Sustainista trench-documentation challenge. It ingests trench photos plus a GeoJSON route, extracts field evidence from the images, geo-matches photos to route segments, detects suspicious reuse, and classifies route coverage for acceptance review.

The active implementation is the trench-QC backend, not the earlier generic PPE-photo scaffold.

## Commands

```bash
python -m pip install -r requirements.txt
cp .env.example .env          # then fill in GEMINI_API_KEY
uvicorn app.main:app --reload  # status page at http://127.0.0.1:8000
TRENCH_PHOTOS_DIR=<local-photo-dir> python tests/smoke_test.py
python scripts/run_batch.py \
  --photos "<local-photo-dir>" \
  --route "../CLP20417A-P1-B00__P20417A_P1_SED_20231103_260515_1778825111/CLP20417A-P1-B00_Trenches_geojson.zip" \
  --out /tmp/trench_results.json \
  --limit 30 \
  --concurrency 4
```

The smoke test reads `TRENCH_PHOTOS_DIR` and `TRENCH_ROUTE_PATH` from the environment (defaults assume a sibling `Company data/` next to the repo). Photos are not committed; the GeoJSON route lives at the repo root.

Environment (`.env`, copied from `.env.example`):

- `GEMINI_API_KEY` enables real VLM extraction in `app/vlm.py`
- `GEMINI_VLM_MODEL` defaults to `gemini-2.5-flash`
- `AI_DETECTOR_MODEL_PATH` is reserved for the optional detector hook in `app/ai_detect.py`

When `GEMINI_API_KEY` is missing, the VLM layer returns deterministic empty assessments so local smoke tests and dry runs remain runnable.

## Architecture

`app/pipeline.py` is the orchestrator:

1. Load trench segments from GeoJSON or zipped GeoJSON via `app/geo.py`.
2. Process photos concurrently:
   - decode image
   - compute pHash
   - call Gemini through `app/vlm.py`
   - merge optional detector output from `app/ai_detect.py`
   - validate burnt-in overlay GPS/timestamp metadata
3. Cluster duplicates with `app/duplicates.py` (perceptual hashes plus GPS/time clustering).
4. Project valid photo GPS onto the nearest route segment with a 15 m cutoff.
5. Classify photos and aggregate 5 m coverage bins in `app/classify.py`.
6. Serialize final JSON in `app/report.py`.

`app/main.py` is intentionally thin: multipart upload validation, temp-file handling, and forwarding to `run_pipeline`.

## Domain model

Per-photo VLM signals:

- duct visibility
- depth / ruler reading with uncertainty support
- sand bedding
- burnt-in GPS and timestamp overlay
- address label OCR
- privacy flags
- pipe end seals
- AI-generated suspicion

Photo categories:

- `green`: duct + readable depth evidence
- `yellow`: duct evidence only
- `red`: depth evidence only
- `cat4`: no useful evidence, duplicate, AI-generated, or off-route

Segment status:

- green / yellow / red aggregation over 5 m bins
- missing bins create coverage gaps and pull otherwise non-red segments to yellow

## Route dataset

The reference dataset is cluster **CLP20417A-P1-B00** (FTTH fiber project "Maria Rain", Carinthia, Austria; WGS84 lon/lat, CRS84, ~14.29°E/46.56°N). Three copies of the same data exist:

- `CLP20417A-P1-B00__.../` at the repo root — zipped GeoJSON, the backend pipeline input.
- `public/geojson/` — unzipped, served statically and fetched by the frontend map.
- `../json/` (sibling of the repo root) — unzipped working copies.

Five layers, each a single `FeatureCollection`:

- **`CLP20417A-P1-B00_Trenches`** (~2.8 MB) — 2,983 `LineString` features, the trench/duct network the pipeline matches photos against. Total length ≈ 19.6 km; 2–4 vertices per line. Key per-segment properties: `masterItem` (trench type), `executionState`, `length` (m), `ductMainFull`/`ductMainShort`, `getAEndpoint`/`getZEndpoint`, `isConnectedToHome`. Trench types: `_01 Künette versiegelt` 1211, `_03 Künette unversiegelt` 553, `_98 Hausanschluss` 421, `_11 Querung offen` 268, `_16 Spülbohrung` 258, `_17 Pressung` 221, plus minor types. States: 2950 Documented, 19 Gross planning, 9 Plan released, 5 Executed. 394 segments connect to a home. `ductType` is null on every feature.
- **`CLP20417A-P1-B00_FCPs`** — 9 `Point` features, Fiber Concentration Points (F012, F169–F172, F175, F200, F202, F205) with home/building counts and core needs.
- **`CLP20417A-P1-B00_FCP_Polygons`** — 9 `Polygon` catchment areas, one per FCP above.
- **`CLP20417A-P1-B00_SiteCluster_Polygons`** — 1 `Polygon`, the overall cluster/tender (`Ausschreibung`) boundary.
- **`CLP20417A-P1-B00_POP`** — empty `FeatureCollection` (Point-of-Presence layer, no features).

Consumers: the backend pipeline (`app/geo.py`) only loads the Trenches layer. The frontend `src/components/MapView.tsx` fetches and renders four layers as toggleable Leaflet overlays — SiteCluster, FCP_Polygons, FCPs, and Trenches; the empty POP layer is not loaded.

## Public interfaces

- `POST /api/audit`
  - multipart `files`: one or more trench photos
  - multipart `route`: GeoJSON or zipped GeoJSON trench route
  - response contains: per-photo category and signals, duplicate / off-route / AI-generated flags, per-segment coverage status, aggregate category and segment counts
- Batch CLI: `scripts/run_batch.py`
- JSON result keys:
  - `route_id`
  - `photos`
  - `segments`
  - `aggregates`

Keep the JSON result shape stable unless the CLI, API consumers, tests, and documentation are updated together.

## Tests and data

- `tests/smoke_test.py` runs end-to-end with mocked VLM responses and validates all four categories.
- Real challenge photos are local-only (not committed); the GeoJSON route is committed at the repo root in `CLP20417A-P1-B00__.../`.
- The known production smoke result for 30 real photos was:
  - 12 green
  - 8 yellow
  - 5 red
  - 5 cat4

## Deliberately deferred

See `improvements.md` for post-hackathon work:

- detector implementation behind `app/ai_detect.py`
- PDF generation in `app/report.py`
- OCR alternatives beyond the current Gemini single-call approach
- persistence, richer forensics, confidence calibration, and frontend map work
