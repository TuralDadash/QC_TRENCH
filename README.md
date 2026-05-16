# APG Photo Audit — Prototype

AI-powered construction photo audit prototype for Austrian Power Grid.
Iteration 1: upload geo-referenced photos and view their GPS locations on an OpenStreetMap map.

## Setup

The **Process** feature (AI photo analysis) calls the Google Gemini API and
needs an API key. Bootstrap it once before the first run:

```bash
cp .env.example .env
```

Then edit `.env` and paste in your own key — get one at
<https://aistudio.google.com/apikey>:

```
GEMINI_API_KEY=your-real-key-here
```

`.env` is git-ignored — **never commit your real key, and never paste it into
this README or any other tracked file.** `docker compose` reads the key from
`.env` automatically and passes it into the container. The rest of the app
runs fine without a key; only Process needs it.

## Run

```bash
docker compose up --build
```

Then open <http://localhost:3000>.

- `/upload` — upload photos (drag & drop). EXIF GPS is extracted server-side; the **Process** button sends uploaded photos to Gemini for trench analysis.
- `/` — map view (OpenStreetMap, OSM Humanitarian, OpenTopoMap layers) with a marker per geo-tagged photo.

Uploaded files and the index live in `./data` (host-mounted), so they survive container restarts.

## Stack

- Next.js 14 (App Router)
- React-Leaflet + OpenStreetMap tile layers
- `exifr` for EXIF / GPS extraction
- Local JSON index + filesystem storage (good enough for the prototype)
