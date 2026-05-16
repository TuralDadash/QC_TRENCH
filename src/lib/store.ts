import { promises as fs } from "fs";
import path from "path";

export type PhotoAnalysis = {
  trench: boolean;
  trenchConf: number;
  measuringStick: boolean;
  measuringStickConf: number;
  depth_cm: number | null;
  depth_cm_confidence: number;
  sandBedding: boolean;
  sandBeddingConf: number;
  warningTape: boolean;
  warningTapeConf: number;
  sideView: boolean;
  sideViewConf: number;
  addressSheet: boolean;
  addressSheetConf: number;
  addresses: string[];
  isDuplicate: boolean;
  duplicateOf: string | null;
  gpsOnSite: boolean | null;
  model: string;
  analysedAt: string;
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
  timestampSource: "exif" | "gps" | "filename" | "mtime" | "overlay" | null;
  gpsSource: "exif" | "overlay" | null;
  overlayApp: string | null;
  overlayLatitude: number | null;
  overlayLongitude: number | null;
  overlayAddress: string | null;
  overlayTakenAt: string | null;
  overlayFound: boolean;
  overlayDetected: boolean;
  fileHash?: string | null;
  analysis?: PhotoAnalysis | null;
};

export type AnalysisUpdate = {
  id: string;
  analysis: PhotoAnalysis | null;
};

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
    return JSON.parse(raw) as PhotoRecord[];
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

export async function mergeAnalysis(updates: AnalysisUpdate[]) {
  const existing = await loadIndex();
  const byId = new Map(updates.map((u) => [u.id, u]));
  const merged = existing.map((rec) => {
    const u = byId.get(rec.id);
    if (!u) return rec;
    return { ...rec, analysis: u.analysis };
  });
  await saveIndex(merged);
  return merged;
}

export function photoFilePath(filename: string) {
  return path.join(PHOTOS_DIR, filename);
}

export { PHOTOS_DIR, DATA_DIR };
