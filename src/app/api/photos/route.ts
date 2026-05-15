import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import exifr from "exifr";
import AdmZip from "adm-zip";
import {
  PHOTOS_DIR,
  appendRecords,
  clearAll,
  loadIndex,
  type PhotoRecord,
} from "@/lib/store";
import { extractOverlay } from "@/lib/overlayOcr";

export const runtime = "nodejs";

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;

// Parallel OCR — CPU-bound (sharp + tesseract subprocesses). 6 is a good
// default for an 8-12 core machine; bump via env when running on bigger
// boxes. Each worker spawns one tesseract subprocess at a time, so the
// global subprocess count == OCR_CONCURRENCY.
const OCR_CONCURRENCY = Math.max(
  1,
  Number(process.env.OCR_CONCURRENCY ?? 6),
);

export async function GET() {
  const records = await loadIndex();
  const sorted = [...records].sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt),
  );
  return Response.json({ photos: sorted });
}

export async function DELETE() {
  await clearAll();
  return Response.json({ ok: true });
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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
    // Broad parse so hasExif/exifFieldCount reflect everything actually in
    // the file; we only pull coords + timestamp + dimensions out of it.
    meta = (await exifr.parse(buf, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      ihdr: true,
      iptc: true,
      xmp: true,
      jfif: true,
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
    takenAt,
    timestampSource,
    width: num(meta?.ExifImageWidth) ?? num(meta?.ImageWidth),
    height: num(meta?.ExifImageHeight) ?? num(meta?.ImageHeight),
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
  // Read the upload body BEFORE returning the streaming response. Reading
  // req.formData() inside the stream's start callback is unreliable on this
  // Next.js version — the request body and response stream can't always
  // coexist that way.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "form parse failed" }),
      { status: 400 },
    );
  }

  const files = form.getAll("files") as File[];
  const paths = form.getAll("paths") as string[];
  const mtimes = form.getAll("mtimes") as string[];
  const project = (form.get("project") as string) || undefined;
  const lotId = (form.get("lotId") as string) || undefined;

  if (files.length === 0) {
    return new Response(JSON.stringify({ error: "no files" }), { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (obj: unknown) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      // First event — surfaces the pre-OCR "preparing" phase so the UI can
      // render a loader while we read+extract zips before the first OCR.
      write({ event: "phase", phase: "preparing" });

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
          const entries = zip.getEntries();
          write({
            event: "extracting",
            archive: file.name,
            done: 0,
            total: entries.length,
          });
          let lastEmit = Date.now();
          for (let ei = 0; ei < entries.length; ei++) {
            const entry = entries[ei];
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
            // Throttle progress events to ~once every 150ms to keep the
            // stream readable without flooding it.
            if (Date.now() - lastEmit > 150 || ei === entries.length - 1) {
              write({
                event: "extracting",
                archive: file.name,
                done: ei + 1,
                total: entries.length,
              });
              lastEmit = Date.now();
            }
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

      write({
        event: "start",
        total: jobs.length,
        concurrency: OCR_CONCURRENCY,
      });

      // Parallel OCR. We mutate a shared next-index counter so each worker
      // picks the next available job; results are written to the stream as
      // they complete (so order doesn't strictly mirror input order).
      const records: PhotoRecord[] = [];
      let nextIndex = 0;
      let done = 0;
      const workers = Array.from(
        { length: Math.min(OCR_CONCURRENCY, jobs.length) },
        async () => {
          while (true) {
            const i = nextIndex++;
            if (i >= jobs.length) break;
            const rec = await processImage(jobs[i]);
            records.push(rec);
            done++;
            write({
              event: "processed",
              done,
              total: jobs.length,
              record: rec,
            });
          }
        },
      );
      await Promise.all(workers);

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
