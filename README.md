# APG Photo Audit — Prototype

AI-powered construction photo audit prototype for Austrian Power Grid.
Iteration 1: upload geo-referenced photos and view their GPS locations on an OpenStreetMap map.

## Run

```bash
docker compose up --build
```

Then open <http://localhost:3000>.

- `/upload` — upload photos (drag & drop). EXIF GPS is extracted server-side.
- `/` — map view (OpenStreetMap, OSM Humanitarian, OpenTopoMap layers) with a marker per geo-tagged photo.

Uploaded files and the index live in `./data` (host-mounted), so they survive container restarts.

## Stack

- Next.js 14 (App Router)
- React-Leaflet + OpenStreetMap tile layers
- `exifr` for EXIF / GPS extraction
- Local JSON index + filesystem storage (good enough for the prototype)
