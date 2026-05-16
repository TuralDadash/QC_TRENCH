import { promises as fs } from "fs";
import path from "path";

// Shape returned by util/analyze_image.py — keys mirror the TrenchAnalysis
// pydantic model in that script, so the JSON is stored verbatim.
export type GeminiAnalysis = {
  has_trench: boolean;
  has_trench_confidence: number;
  has_vertical_measuring_stick: boolean;
  has_vertical_measuring_stick_confidence: number;
  has_address_sheet: boolean;
  has_address_sheet_confidence: number;
  addresses: string[];
  has_sand_bedding: boolean;
  has_sand_bedding_confidence: number;
  depth_cm: number | null;
  depth_cm_confidence: number;
  gps_present: boolean;
  latitude: number | null;
  longitude: number | null;
  address_present: boolean;
  address: string | null;
  datetime_present: boolean;
  datetime: string | null;
};

// Shape returned by util/backend_analyze.py — mirrors the PhotoAssessment
// pydantic model in backend/app/vlm.py (the "alternative" analysis path).
export type BackendAssessment = {
  is_construction_photo: boolean;
  is_construction_photo_confidence: number;
  is_likely_ai_generated: boolean;
  is_likely_ai_generated_confidence: number;
  overall_confidence: number;
  duct: { visible: boolean; confidence: number; notes: string };
  depth: {
    ruler_visible: boolean;
    depth_value_cm: number | null;
    depth_range_cm: number[] | null;
    uncertain: boolean;
    confidence: number;
    notes: string;
  };
  sand_bedding: {
    status: "sand" | "uncertain" | "not_sand";
    confidence: number;
  };
  burnt_in_metadata: {
    gps_lat: number | null;
    gps_lon: number | null;
    timestamp_iso: string | null;
    raw_text: string;
    confidence: number;
  };
  address_label: { found: boolean; text: string | null; confidence: number };
  privacy_flags: {
    faces_visible: boolean;
    license_plates_visible: boolean;
  };
  pipe_end_seals: {
    status: "sealed" | "unsealed" | "not_visible";
    confidence: number;
  };
};

// One analysis run of a photo through a specific path. `kind` discriminates
// the `result` shape: "util" -> GeminiAnalysis, "backend" -> BackendAssessment.
export type AnalysisRun = {
  pathId: string;
  kind: "util" | "backend";
  analyzedAt: string | null;
  error: string | null;
  result: GeminiAnalysis | BackendAssessment | null;
};

export type PhotoRecord = {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  project?: string;
  lotId?: string;
  sourcePath?: string;
  latitude: number | null;
  longitude: number | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  hasGps: boolean;
  hasExif: boolean;
  exifFieldCount: number;
  exifKeys?: string[];
  timestampSource: "exif" | "gps" | "filename" | "mtime" | "overlay" | null;
  gpsSource: "exif" | "overlay" | null;
  overlayApp: string | null;
  overlayLatitude: number | null;
  overlayLongitude: number | null;
  overlayAddress: string | null;
  overlayTakenAt: string | null;
  overlayFound: boolean;
  overlayDetected: boolean;
  // Analysis runs keyed by path id ("util:v1.txt", "backend", ...). A photo
  // can be analysed by several paths; each result is kept for comparison.
  analyses?: Record<string, AnalysisRun>;
};

export type AnalysisRunUpdate = {
  id: string;
  run: AnalysisRun;
};

// Old single-analysis records (pre path-comparison) stored a flat `analysis`.
type LegacyRecord = PhotoRecord & {
  analysis?: GeminiAnalysis | null;
  analyzedAt?: string | null;
  analysisError?: string | null;
};

function migrateRecord(raw: LegacyRecord): PhotoRecord {
  if (raw.analyses || raw.analysis === undefined) {
    const { analysis, analyzedAt, analysisError, ...rest } = raw;
    void analysis;
    void analyzedAt;
    void analysisError;
    return rest;
  }
  const { analysis, analyzedAt, analysisError, ...rest } = raw;
  const hadRun = analysis != null || analysisError != null;
  return {
    ...rest,
    analyses: hadRun
      ? {
          "util:v1.txt": {
            pathId: "util:v1.txt",
            kind: "util",
            analyzedAt: analyzedAt ?? null,
            error: analysisError ?? null,
            result: analysis ?? null,
          },
        }
      : {},
  };
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

async function ensureDirs() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
}

export async function loadIndex(): Promise<PhotoRecord[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw) as LegacyRecord[];
    return parsed.map(migrateRecord);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveIndex(records: PhotoRecord[]) {
  await ensureDirs();
  await fs.writeFile(INDEX_FILE, JSON.stringify(records, null, 2), "utf8");
}

export async function clearAll() {
  await ensureDirs();
  // Empty the photos directory wholesale (in case earlier wipes left orphans
  // not referenced by the current index).
  const entries = await fs.readdir(PHOTOS_DIR).catch(() => [] as string[]);
  await Promise.all(
    entries.map((name) =>
      fs.unlink(path.join(PHOTOS_DIR, name)).catch(() => undefined),
    ),
  );
  await saveIndex([]);
}

export async function appendRecords(newOnes: PhotoRecord[]) {
  const existing = await loadIndex();
  const merged = [...existing, ...newOnes];
  await saveIndex(merged);
  return merged;
}

// Patch analysis runs onto existing records by id, keyed by path id so
// results from different paths coexist. Reloads the index each call so it's
// safe to interleave with uploads appending records.
export async function mergeAnalysisRun(updates: AnalysisRunUpdate[]) {
  const existing = await loadIndex();
  const byId = new Map<string, AnalysisRun[]>();
  for (const u of updates) {
    const list = byId.get(u.id) ?? [];
    list.push(u.run);
    byId.set(u.id, list);
  }
  const merged = existing.map((rec) => {
    const runs = byId.get(rec.id);
    if (!runs) return rec;
    const analyses = { ...(rec.analyses ?? {}) };
    for (const run of runs) analyses[run.pathId] = run;
    return { ...rec, analyses };
  });
  await saveIndex(merged);
  return merged;
}

export function photoFilePath(filename: string) {
  return path.join(PHOTOS_DIR, filename);
}

export { PHOTOS_DIR, DATA_DIR };
