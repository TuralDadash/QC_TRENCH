import { promises as fs } from "fs";
import path from "path";

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
  altitude: number | null;
  gpsAccuracy: number | null;
  gpsDirection: number | null;
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  software: string | null;
  orientation: number | null;
  width: number | null;
  height: number | null;
  focalLength: number | null;
  fNumber: number | null;
  iso: number | null;
  exposureTime: number | null;
  hasGps: boolean;
  hasExif: boolean;
  exifFieldCount: number;
  exifKeys?: string[];
  timestampSource: "exif" | "gps" | "filename" | "mtime" | null;
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

export async function appendRecords(newOnes: PhotoRecord[]) {
  const existing = await loadIndex();
  const merged = [...existing, ...newOnes];
  await saveIndex(merged);
  return merged;
}

export function photoFilePath(filename: string) {
  return path.join(PHOTOS_DIR, filename);
}

export { PHOTOS_DIR, DATA_DIR };
