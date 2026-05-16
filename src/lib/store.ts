import { promises as fs } from "fs";
import path from "path";
import { query, withTransaction, initializeDatabase } from "./db";

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
  duct: { visible: boolean; confidence: number };
  depth: {
    ruler_visible: boolean;
    depth_value_cm: number | null;
    depth_range_cm: number[] | null;
    uncertain: boolean;
    confidence: number;
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
  category?: number | null;
  hasDuplicate?: boolean;
  duplicateOfId?: string | null;
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

let dbInitialized = false;

async function ensureDirs() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
}

async function ensureDbInitialized() {
  if (!dbInitialized) {
    try {
      await initializeDatabase();
      dbInitialized = true;
    } catch (error) {
      console.error("Failed to initialize database:", error);
      throw error;
    }
  }
}

function rowToPhotoRecord(row: any): PhotoRecord {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    size: row.size,
    uploadedAt: row.uploaded_at?.toISOString() || new Date().toISOString(),
    project: row.project,
    lotId: row.lot_id,
    sourcePath: row.source_path,
    latitude:
      row.latitude != null ? parseFloat(String(row.latitude)) : null,
    longitude:
      row.longitude != null ? parseFloat(String(row.longitude)) : null,
    takenAt: row.taken_at?.toISOString() || null,
    width: row.width,
    height: row.height,
    hasGps: row.has_gps || false,
    hasExif: row.has_exif || false,
    exifFieldCount: row.exif_field_count || 0,
    exifKeys: row.exif_keys || [],
    timestampSource: row.timestamp_source,
    gpsSource: row.gps_source,
    overlayApp: row.overlay_app,
    overlayLatitude:
      row.overlay_latitude != null
        ? parseFloat(String(row.overlay_latitude))
        : null,
    overlayLongitude:
      row.overlay_longitude != null
        ? parseFloat(String(row.overlay_longitude))
        : null,
    overlayAddress: row.overlay_address,
    overlayTakenAt: row.overlay_taken_at?.toISOString() || null,
    overlayFound: row.overlay_found || false,
    overlayDetected: row.overlay_detected || false,
    category:
      typeof row.category === "number" ? row.category : row.category != null
        ? Number(row.category)
        : null,
    hasDuplicate: row.has_duplicate || false,
    duplicateOfId: row.duplicate_of_id || null,
    analyses: {},
  };
}

// Extracts individual Gemini analysis fields for storage as dedicated columns.
// Returns null values for all fields if the result is not a GeminiAnalysis.
function extractGeminiFields(run: AnalysisRun): {
  has_trench: boolean | null;
  has_trench_confidence: number | null;
  has_vertical_measuring_stick: boolean | null;
  has_vertical_measuring_stick_confidence: number | null;
  has_address_sheet: boolean | null;
  has_address_sheet_confidence: number | null;
  has_sand_bedding: boolean | null;
  has_sand_bedding_confidence: number | null;
  depth_cm: number | null;
  depth_cm_confidence: number | null;
  gps_present: boolean | null;
  latitude: number | null;
  longitude: number | null;
  address_present: boolean | null;
  address: string | null;
  datetime_present: boolean | null;
  datetime: Date | null;
} {
  const empty = {
    has_trench: null,
    has_trench_confidence: null,
    has_vertical_measuring_stick: null,
    has_vertical_measuring_stick_confidence: null,
    has_address_sheet: null,
    has_address_sheet_confidence: null,
    has_sand_bedding: null,
    has_sand_bedding_confidence: null,
    depth_cm: null,
    depth_cm_confidence: null,
    gps_present: null,
    latitude: null,
    longitude: null,
    address_present: null,
    address: null,
    datetime_present: null,
    datetime: null,
  };

  if (run.kind !== "util" || !run.result) return empty;

  const g = run.result as GeminiAnalysis;

  return {
    has_trench: g.has_trench ?? null,
    has_trench_confidence: g.has_trench_confidence ?? null,
    has_vertical_measuring_stick: g.has_vertical_measuring_stick ?? null,
    has_vertical_measuring_stick_confidence:
      g.has_vertical_measuring_stick_confidence ?? null,
    has_address_sheet: g.has_address_sheet ?? null,
    has_address_sheet_confidence: g.has_address_sheet_confidence ?? null,
    has_sand_bedding: g.has_sand_bedding ?? null,
    has_sand_bedding_confidence: g.has_sand_bedding_confidence ?? null,
    depth_cm: g.depth_cm ?? null,
    depth_cm_confidence: g.depth_cm_confidence ?? null,
    gps_present: g.gps_present ?? null,
    latitude: g.latitude ?? null,
    longitude: g.longitude ?? null,
    address_present: g.address_present ?? null,
    address: g.address ?? null,
    datetime_present: g.datetime_present ?? null,
    datetime: g.datetime ? new Date(g.datetime) : null,
  };
}

export async function loadIndex(): Promise<PhotoRecord[]> {
  await ensureDirs();
  await ensureDbInitialized();

  try {
    const result = await query(
      `SELECT * FROM photo_metadata ORDER BY uploaded_at DESC`,
    );

    const photoIds = result.rows.map((row: any) => row.id);
    const analysesMap: Record<string, Record<string, AnalysisRun>> = {};

    if (photoIds.length > 0) {
      const addressResult = await query(
        `SELECT photo_id, path_id, address
         FROM photo_analysis_addresses
         WHERE photo_id = ANY($1)
         ORDER BY photo_id, path_id, position`,
        [photoIds],
      );

      const addressMap: Record<string, Record<string, string[]>> = {};
      for (const row of addressResult.rows) {
        if (!addressMap[row.photo_id]) {
          addressMap[row.photo_id] = {};
        }
        if (!addressMap[row.photo_id][row.path_id]) {
          addressMap[row.photo_id][row.path_id] = [];
        }
        addressMap[row.photo_id][row.path_id].push(row.address);
      }

      const analysisResult = await query(
        `SELECT photo_id, path_id, kind, analyzed_at, error, result
         FROM photo_analyses
         WHERE photo_id = ANY($1)`,
        [photoIds],
      );

      for (const row of analysisResult.rows) {
        if (!analysesMap[row.photo_id]) {
          analysesMap[row.photo_id] = {};
        }

        let parsedResult = row.result;
        if (parsedResult && row.kind === "util") {
          // Re-attach addresses from the normalised table into the result blob
          // so callers see the complete GeminiAnalysis shape.
          const addrs =
            addressMap[row.photo_id]?.[row.path_id] ?? [];
          parsedResult = { ...parsedResult, addresses: addrs };
        }

        analysesMap[row.photo_id][row.path_id] = {
          pathId: row.path_id,
          kind: row.kind,
          analyzedAt: row.analyzed_at?.toISOString() || null,
          error: row.error,
          result: parsedResult,
        };
      }
    }

    return result.rows.map((row: any) => ({
      ...rowToPhotoRecord(row),
      analyses: analysesMap[row.id] || {},
    }));
  } catch (error) {
    console.error("Failed to load index from database:", error);
    throw error;
  }
}

export async function saveIndex(records: PhotoRecord[]) {
  await ensureDirs();
  await ensureDbInitialized();

  await withTransaction(async (client) => {
    await client.query("DELETE FROM photo_analyses");
    await client.query("DELETE FROM photo_metadata");

    for (const record of records) {
      await client.query(
        `INSERT INTO photo_metadata (
          id, filename, original_name, size, uploaded_at, project, lot_id,
          source_path, latitude, longitude, taken_at, width, height,
          has_gps, has_exif, exif_field_count, exif_keys, timestamp_source,
          gps_source, overlay_app, overlay_latitude, overlay_longitude,
          overlay_address, overlay_taken_at, overlay_found, overlay_detected,
          category, has_duplicate, duplicate_of_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
          $28, $29
        )`,
        [
          record.id,
          record.filename,
          record.originalName,
          record.size,
          new Date(record.uploadedAt),
          record.project || null,
          record.lotId || null,
          record.sourcePath || null,
          record.latitude,
          record.longitude,
          record.takenAt ? new Date(record.takenAt) : null,
          record.width,
          record.height,
          record.hasGps,
          record.hasExif,
          record.exifFieldCount,
          record.exifKeys || [],
          record.timestampSource,
          record.gpsSource,
          record.overlayApp || null,
          record.overlayLatitude,
          record.overlayLongitude,
          record.overlayAddress || null,
          record.overlayTakenAt ? new Date(record.overlayTakenAt) : null,
          record.overlayFound,
          record.overlayDetected,
          record.category ?? null,
          record.hasDuplicate ?? false,
          record.duplicateOfId ?? null,
        ],
      );

      for (const run of Object.values(record.analyses || {})) {
        const g = extractGeminiFields(run);

        await client.query(
          `INSERT INTO photo_analyses (
            photo_id, path_id, kind, analyzed_at, error, result,
            has_trench, has_trench_confidence,
            has_vertical_measuring_stick, has_vertical_measuring_stick_confidence,
            has_address_sheet, has_address_sheet_confidence,
            has_sand_bedding, has_sand_bedding_confidence,
            depth_cm, depth_cm_confidence,
            gps_present, latitude, longitude,
            address_present, address,
            datetime_present, datetime
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23
          )
          ON CONFLICT (photo_id, path_id) DO UPDATE SET
            kind = EXCLUDED.kind,
            analyzed_at = EXCLUDED.analyzed_at,
            error = EXCLUDED.error,
            result = EXCLUDED.result,
            has_trench = EXCLUDED.has_trench,
            has_trench_confidence = EXCLUDED.has_trench_confidence,
            has_vertical_measuring_stick = EXCLUDED.has_vertical_measuring_stick,
            has_vertical_measuring_stick_confidence = EXCLUDED.has_vertical_measuring_stick_confidence,
            has_address_sheet = EXCLUDED.has_address_sheet,
            has_address_sheet_confidence = EXCLUDED.has_address_sheet_confidence,
            has_sand_bedding = EXCLUDED.has_sand_bedding,
            has_sand_bedding_confidence = EXCLUDED.has_sand_bedding_confidence,
            depth_cm = EXCLUDED.depth_cm,
            depth_cm_confidence = EXCLUDED.depth_cm_confidence,
            gps_present = EXCLUDED.gps_present,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            address_present = EXCLUDED.address_present,
            address = EXCLUDED.address,
            datetime_present = EXCLUDED.datetime_present,
            datetime = EXCLUDED.datetime,
            updated_at = NOW()`,
          [
            record.id,
            run.pathId,
            run.kind,
            run.analyzedAt ? new Date(run.analyzedAt) : null,
            run.error || null,
            JSON.stringify(run.result || null),
            g.has_trench,
            g.has_trench_confidence,
            g.has_vertical_measuring_stick,
            g.has_vertical_measuring_stick_confidence,
            g.has_address_sheet,
            g.has_address_sheet_confidence,
            g.has_sand_bedding,
            g.has_sand_bedding_confidence,
            g.depth_cm,
            g.depth_cm_confidence,
            g.gps_present,
            g.latitude,
            g.longitude,
            g.address_present,
            g.address,
            g.datetime_present,
            g.datetime,
          ],
        );

        const addresses = Array.isArray(
          (run.result as GeminiAnalysis)?.addresses,
        )
          ? (run.result as GeminiAnalysis).addresses
          : [];
        for (let index = 0; index < addresses.length; index++) {
          await client.query(
            `INSERT INTO photo_analysis_addresses (
              photo_id, path_id, address, position
            ) VALUES ($1, $2, $3, $4)`,
            [record.id, run.pathId, addresses[index], index],
          );
        }
      }
    }
  });
}

export async function clearAll() {
  await ensureDirs();
  await ensureDbInitialized();

  const entries = await fs.readdir(PHOTOS_DIR).catch(() => [] as string[]);
  await Promise.all(
    entries.map((name) =>
      fs.unlink(path.join(PHOTOS_DIR, name)).catch(() => undefined),
    ),
  );

  await withTransaction(async (client) => {
    await client.query("DELETE FROM photo_analysis_addresses");
    await client.query("DELETE FROM photo_analyses");
    await client.query("DELETE FROM photo_metadata");
  });
}

export async function appendRecords(newOnes: PhotoRecord[]) {
  await ensureDirs();
  await ensureDbInitialized();

  await withTransaction(async (client) => {
    for (const record of newOnes) {
      await client.query(
        `INSERT INTO photo_metadata (
          id, filename, original_name, size, uploaded_at, project, lot_id,
          source_path, latitude, longitude, taken_at, width, height,
          has_gps, has_exif, exif_field_count, exif_keys, timestamp_source,
          gps_source, overlay_app, overlay_latitude, overlay_longitude,
          overlay_address, overlay_taken_at, overlay_found, overlay_detected,
          category, has_duplicate, duplicate_of_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
          $28, $29
        )
        ON CONFLICT (id) DO UPDATE SET
          filename = EXCLUDED.filename,
          original_name = EXCLUDED.original_name,
          size = EXCLUDED.size,
          uploaded_at = EXCLUDED.uploaded_at,
          project = EXCLUDED.project,
          lot_id = EXCLUDED.lot_id,
          source_path = EXCLUDED.source_path,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          taken_at = EXCLUDED.taken_at,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          has_gps = EXCLUDED.has_gps,
          has_exif = EXCLUDED.has_exif,
          exif_field_count = EXCLUDED.exif_field_count,
          exif_keys = EXCLUDED.exif_keys,
          timestamp_source = EXCLUDED.timestamp_source,
          gps_source = EXCLUDED.gps_source,
          overlay_app = EXCLUDED.overlay_app,
          overlay_latitude = EXCLUDED.overlay_latitude,
          overlay_longitude = EXCLUDED.overlay_longitude,
          overlay_address = EXCLUDED.overlay_address,
          overlay_taken_at = EXCLUDED.overlay_taken_at,
          overlay_found = EXCLUDED.overlay_found,
          overlay_detected = EXCLUDED.overlay_detected,
          category = EXCLUDED.category`,
        [
          record.id,
          record.filename,
          record.originalName,
          record.size,
          new Date(record.uploadedAt),
          record.project || null,
          record.lotId || null,
          record.sourcePath || null,
          record.latitude,
          record.longitude,
          record.takenAt ? new Date(record.takenAt) : null,
          record.width,
          record.height,
          record.hasGps,
          record.hasExif,
          record.exifFieldCount,
          record.exifKeys || [],
          record.timestampSource,
          record.gpsSource,
          record.overlayApp || null,
          record.overlayLatitude,
          record.overlayLongitude,
          record.overlayAddress || null,
          record.overlayTakenAt ? new Date(record.overlayTakenAt) : null,
          record.overlayFound,
          record.overlayDetected,
          record.category ?? null,
          record.hasDuplicate ?? false,
          record.duplicateOfId ?? null,
        ],
      );
    }
  });

  return loadIndex();
}

export async function mergeAnalysisRun(updates: AnalysisRunUpdate[]) {
  await ensureDbInitialized();

  await withTransaction(async (client) => {
    for (const update of updates) {
      const run = update.run;
      const g = extractGeminiFields(run);

      await client.query(
        `INSERT INTO photo_analyses (
          photo_id, path_id, kind, analyzed_at, error, result,
          has_trench, has_trench_confidence,
          has_vertical_measuring_stick, has_vertical_measuring_stick_confidence,
          has_address_sheet, has_address_sheet_confidence,
          has_sand_bedding, has_sand_bedding_confidence,
          depth_cm, depth_cm_confidence,
          gps_present, latitude, longitude,
          address_present, address,
          datetime_present, datetime
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23
        )
        ON CONFLICT (photo_id, path_id) DO UPDATE SET
          kind = EXCLUDED.kind,
          analyzed_at = EXCLUDED.analyzed_at,
          error = EXCLUDED.error,
          result = EXCLUDED.result,
          has_trench = EXCLUDED.has_trench,
          has_trench_confidence = EXCLUDED.has_trench_confidence,
          has_vertical_measuring_stick = EXCLUDED.has_vertical_measuring_stick,
          has_vertical_measuring_stick_confidence = EXCLUDED.has_vertical_measuring_stick_confidence,
          has_address_sheet = EXCLUDED.has_address_sheet,
          has_address_sheet_confidence = EXCLUDED.has_address_sheet_confidence,
          has_sand_bedding = EXCLUDED.has_sand_bedding,
          has_sand_bedding_confidence = EXCLUDED.has_sand_bedding_confidence,
          depth_cm = EXCLUDED.depth_cm,
          depth_cm_confidence = EXCLUDED.depth_cm_confidence,
          gps_present = EXCLUDED.gps_present,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          address_present = EXCLUDED.address_present,
          address = EXCLUDED.address,
          datetime_present = EXCLUDED.datetime_present,
          datetime = EXCLUDED.datetime,
          updated_at = NOW()`,
        [
          update.id,
          run.pathId,
          run.kind,
          run.analyzedAt ? new Date(run.analyzedAt) : null,
          run.error || null,
          JSON.stringify(run.result || null),
          g.has_trench,
          g.has_trench_confidence,
          g.has_vertical_measuring_stick,
          g.has_vertical_measuring_stick_confidence,
          g.has_address_sheet,
          g.has_address_sheet_confidence,
          g.has_sand_bedding,
          g.has_sand_bedding_confidence,
          g.depth_cm,
          g.depth_cm_confidence,
          g.gps_present,
          g.latitude,
          g.longitude,
          g.address_present,
          g.address,
          g.datetime_present,
          g.datetime,
        ],
      );

      await client.query(
        `DELETE FROM photo_analysis_addresses
         WHERE photo_id = $1 AND path_id = $2`,
        [update.id, run.pathId],
      );

      const addresses = Array.isArray(
        (run.result as GeminiAnalysis)?.addresses,
      )
        ? (run.result as GeminiAnalysis).addresses
        : [];
      for (let index = 0; index < addresses.length; index++) {
        await client.query(
          `INSERT INTO photo_analysis_addresses (
            photo_id, path_id, address, position
          ) VALUES ($1, $2, $3, $4)`,
          [update.id, run.pathId, addresses[index], index],
        );
      }
    }
  });

  return loadIndex();
}

export function photoFilePath(filename: string) {
  return path.join(PHOTOS_DIR, filename);
}

export { PHOTOS_DIR, DATA_DIR };