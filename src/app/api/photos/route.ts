import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import exifr from "exifr";
import AdmZip from "adm-zip";
import {
  PHOTOS_DIR,
  appendRecords,
  loadIndex,
  type PhotoRecord,
} from "@/lib/store";
import { extractOverlay } from "@/lib/overlayOcr";

export const runtime = "nodejs";

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;

export async function GET() {
  const records = await loadIndex();
  const sorted = [...records].sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt),
  );
  return Response.json({ photos: sorted });
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

// Heuristic timestamp extraction from common phone / messenger filename patterns.
// Returns ISO string when the filename clearly encodes a date+time.
function parseTimestampFromFilename(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, "");

  // WhatsApp: "WhatsApp Image 2024-10-03 at 17_04_38" / "WhatsApp Image 2024-10-03 at 17_04_38 (3)"
  let m = base.match(
    /(\d{4})-(\d{2})-(\d{2}).*?(\d{2})[_:.](\d{2})[_:.](\d{2})/,
  );
  if (m) return iso(m[1], m[2], m[3], m[4], m[5], m[6]);

  // iOS / Android: "IMG_20231005_142342", "20231005_142342", "PXL_20240615_123456789"
  m = base.match(/(\d{4})(\d{2})(\d{2})[_T-]?(\d{2})(\d{2})(\d{2})/);
  if (m) return iso(m[1], m[2], m[3], m[4], m[5], m[6]);

  return null;
}

function iso(y: string, mo: string, d: string, h: string, mi: string, s: string) {
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

async function processImage(opts: {
  buf: Buffer;
  originalName: string;
  sourcePath?: string;
  project?: string;
  lotId?: string;
  fallbackMtimeMs?: number | null;
}): Promise<PhotoRecord> {
  const { buf, originalName, sourcePath, project, lotId, fallbackMtimeMs } = opts;
  const ext = path.extname(originalName) || ".jpg";
  const id = crypto.randomUUID();
  const filename = `${id}${ext.toLowerCase()}`;
  await fs.writeFile(path.join(PHOTOS_DIR, filename), buf);

  let meta: Record<string, unknown> | null = null;
  try {
    // Broad parse — TIFF + EXIF + GPS + PNG IHDR + IPTC + XMP + maker notes.
    meta = (await exifr.parse(buf, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      ihdr: true,
      iptc: true,
      xmp: true,
      jfif: true,
      makerNote: true,
      userComment: true,
      mergeOutput: true,
      sanitize: true,
    })) as Record<string, unknown> | null;
  } catch {
    // ignore
  }

  const exifKeys = meta
    ? Object.entries(meta)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k]) => k)
    : [];

  // EXIF GPS — first from the merged parse, then a second pass with the
  // dedicated exifr.gps() helper.
  let exifLat = num(meta?.latitude);
  let exifLon = num(meta?.longitude);
  if (exifLat === null || exifLon === null) {
    try {
      const gps = await exifr.gps(buf);
      if (
        gps &&
        typeof gps.latitude === "number" &&
        typeof gps.longitude === "number"
      ) {
        exifLat = gps.latitude;
        exifLon = gps.longitude;
      }
    } catch {
      // ignore
    }
  }

  // Overlay OCR — always run, since the overlay is the audit-grade source
  // even when EXIF is present. Stored as overlay* fields and used as the
  // *primary* coordinate source when present, with EXIF as the fallback.
  const overlay = await extractOverlay(buf).catch(() => null);

  const lat = overlay?.latitude ?? exifLat;
  const lon = overlay?.longitude ?? exifLon;
  const gpsSource: PhotoRecord["gpsSource"] =
    overlay?.latitude != null && overlay?.longitude != null
      ? "overlay"
      : exifLat !== null && exifLon !== null
        ? "exif"
        : null;

  // Timestamp resolution: overlay first (audit source), then EXIF capture
  // time, GPS-stamp, filename, file mtime.
  let takenAt: string | null = null;
  let timestampSource: PhotoRecord["timestampSource"] = null;

  if (overlay?.takenAt) {
    takenAt = overlay.takenAt;
    timestampSource = "overlay";
  }
  if (!takenAt) {
    const exifTime =
      (meta?.DateTimeOriginal as Date | undefined) ||
      (meta?.CreateDate as Date | undefined) ||
      (meta?.DateTime as Date | undefined) ||
      (meta?.ModifyDate as Date | undefined);
    if (exifTime instanceof Date && !Number.isNaN(exifTime.getTime())) {
      takenAt = exifTime.toISOString();
      timestampSource = "exif";
    }
  }
  if (!takenAt) {
    const gpsStamp = meta?.GPSDateStamp;
    const gpsTime = meta?.GPSTimeStamp;
    if (typeof gpsStamp === "string" && Array.isArray(gpsTime) && gpsTime.length === 3) {
      const dt = new Date(
        `${gpsStamp.replace(/:/g, "-")}T${String(gpsTime[0]).padStart(2, "0")}:${String(
          gpsTime[1],
        ).padStart(2, "0")}:${String(Math.floor(Number(gpsTime[2]))).padStart(2, "0")}Z`,
      );
      if (!Number.isNaN(dt.getTime())) {
        takenAt = dt.toISOString();
        timestampSource = "gps";
      }
    }
  }
  if (!takenAt) {
    const fromName = parseTimestampFromFilename(originalName);
    if (fromName) {
      takenAt = fromName;
      timestampSource = "filename";
    }
  }
  if (!takenAt && fallbackMtimeMs && Number.isFinite(fallbackMtimeMs)) {
    const dt = new Date(fallbackMtimeMs);
    if (!Number.isNaN(dt.getTime())) {
      takenAt = dt.toISOString();
      timestampSource = "mtime";
    }
  }

  return {
    id,
    filename,
    originalName,
    size: buf.length,
    uploadedAt: new Date().toISOString(),
    project,
    lotId,
    sourcePath,
    latitude: lat,
    longitude: lon,
    altitude: num(meta?.GPSAltitude),
    gpsAccuracy: num(meta?.GPSHPositioningError) ?? num(meta?.GPSDOP),
    gpsDirection: num(meta?.GPSImgDirection),
    takenAt,
    timestampSource,
    cameraMake: str(meta?.Make),
    cameraModel: str(meta?.Model),
    lensModel: str(meta?.LensModel) ?? str(meta?.LensInfo),
    software: str(meta?.Software),
    orientation: num(meta?.Orientation),
    width: num(meta?.ExifImageWidth) ?? num(meta?.ImageWidth),
    height: num(meta?.ExifImageHeight) ?? num(meta?.ImageHeight),
    focalLength: num(meta?.FocalLength),
    fNumber: num(meta?.FNumber),
    iso: num(meta?.ISO) ?? num(meta?.ISOSpeedRatings),
    exposureTime: num(meta?.ExposureTime),
    hasGps: lat !== null && lon !== null,
    hasExif: exifKeys.length > 0,
    exifFieldCount: exifKeys.length,
    exifKeys,
    gpsSource,
    overlayApp: overlay?.app ?? null,
    overlayLatitude: overlay?.latitude ?? null,
    overlayLongitude: overlay?.longitude ?? null,
    overlayAddress: overlay?.address ?? null,
    overlayTakenAt: overlay?.takenAt ?? null,
    overlayFound: overlay?.found ?? false,
    overlayDetected: overlay?.detected ?? false,
  };
}

type Job = {
  buf: Buffer;
  originalName: string;
  sourcePath?: string;
  project?: string;
  lotId?: string;
  fallbackMtimeMs?: number | null;
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files") as File[];
  const paths = form.getAll("paths") as string[];
  const mtimes = form.getAll("mtimes") as string[];
  const project = (form.get("project") as string) || undefined;
  const lotId = (form.get("lotId") as string) || undefined;

  if (files.length === 0) {
    return new Response(JSON.stringify({ error: "no files" }), {
      status: 400,
    });
  }

  await fs.mkdir(PHOTOS_DIR, { recursive: true });

  const jobs: Job[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || typeof file === "string") continue;
    const nameLower = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    const mtime = mtimes[i] ? Number(mtimes[i]) : null;

    if (nameLower.endsWith(".zip")) {
      const archiveProject = project || file.name.replace(/\.zip$/i, "");
      let zip: AdmZip;
      try {
        zip = new AdmZip(buf);
      } catch {
        skipped.push({ name: file.name, reason: "invalid zip" });
        continue;
      }
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName;
        const base = entryName.split("/").pop() || entryName;
        if (base.startsWith(".") || entryName.startsWith("__MACOSX")) continue;
        if (!IMAGE_EXT_RE.test(base)) {
          skipped.push({ name: entryName, reason: "not an image" });
          continue;
        }
        const zipEntryMtime = entry.header.time?.getTime() ?? null;
        jobs.push({
          buf: entry.getData(),
          originalName: base,
          sourcePath: entryName,
          project: archiveProject,
          lotId,
          fallbackMtimeMs: zipEntryMtime,
        });
      }
    } else if (IMAGE_EXT_RE.test(file.name)) {
      jobs.push({
        buf,
        originalName: file.name,
        sourcePath: paths[i] || file.name,
        project,
        lotId,
        fallbackMtimeMs: mtime,
      });
    } else {
      skipped.push({ name: file.name, reason: "unsupported type" });
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (obj: unknown) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      write({ event: "start", total: jobs.length });
      const records: PhotoRecord[] = [];
      for (let i = 0; i < jobs.length; i++) {
        const rec = await processImage(jobs[i]);
        records.push(rec);
        write({
          event: "processed",
          index: i + 1,
          total: jobs.length,
          record: rec,
        });
      }
      if (records.length > 0) await appendRecords(records);
      write({ event: "done", skipped });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
