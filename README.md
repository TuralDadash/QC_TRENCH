# QC Trench — AI-Powered Construction Photo Audit

AI-powered quality control for fiber trench construction documentation,
built for the Austrian Power Grid (APG) / ÖGIG hackathon challenge.

---

## Setup

```bash
cp .env.example .env
```

Edit `.env` and add your Gemini API key — get one at <https://aistudio.google.com/apikey>:

```env
GEMINI_API_KEY=your-real-key-here
```

## Run

```bash
docker compose up --build
```

Then open <http://localhost:3000>.

`/upload` — upload photos (drag & drop), EXIF GPS is extracted server-side.
`/` — map view with a marker per geo-tagged photo.

---

## Workflow

| Step | Description |
|---|---|
| 1. Metadata | Validate timestamps and GPS against project site |
| 2. Duplicates | Detect reused photos via perceptual hashing and GPS clustering |
| 3. AI Detection | Flag AI-generated or unrelated images |
| 4. Categorization | Classify each photo (see table below) |
| 5. Depth Check | Validate depth measurement for Cat 1 and Cat 3 |

| Category | Evidence | Status |
|---|---|---|
| Cat 1 | Duct + depth readable | green |
| Cat 2 | Duct only | yellow |
| Cat 3 | Depth only | red |
| Cat 4 | Duplicate, fraud, AI-generated, no evidence | rejected |

---

## Backend Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API available at `http://127.0.0.1:8000`.

---

## API Reference

`POST /api/audit`

| Field | Type | Description |
|---|---|---|
| `files` | multipart | One or more trench photos |
| `route` | multipart | GeoJSON or zipped GeoJSON trench route |

Response fields: `route_id`, `photos`, `segments`, `aggregates`

---

## Project Structure

```
├── src/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── pipeline.py
│   │   ├── vlm.py
│   │   ├── classify.py
│   │   ├── geo.py
│   │   ├── duplicates.py
│   │   └── report.py
│   ├── scripts/
│   └── tests/
├── public/geojson/
├── data/
├── docker-compose.yml
└── .env.example
```

---

## Route Dataset

Reference cluster: **CLP20417A-P1-B00** — FTTH fiber project "Maria Rain", Carinthia, Austria.
Approximately 19.6 km of trench network, 2,983 LineString segments, WGS84.

| Layer | Description |
|---|---|
| Trenches | Trench and duct network — pipeline input and map overlay |
| FCPs | 9 Fiber Concentration Points |
| FCP_Polygons | Catchment area per FCP |
| SiteCluster_Polygons | Overall cluster boundary |

---

## Stack

Next.js 14 · React-Leaflet · FastAPI · PostgreSQL 16 · Google Gemini 2.5 Flash · Docker
