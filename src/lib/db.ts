import { Pool, PoolClient } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/trench_qc";

    pool = new Pool({
      connectionString,
      // Increase timeout for slow connections
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 20,
    });

    pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
    });
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase() {
  const migrationSQL = `
    CREATE TABLE IF NOT EXISTS photo_metadata (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
      project TEXT,
      lot_id TEXT,
      source_path TEXT,
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      taken_at TIMESTAMP,
      width INTEGER,
      height INTEGER,
      has_gps BOOLEAN DEFAULT FALSE,
      has_exif BOOLEAN DEFAULT FALSE,
      exif_field_count INTEGER DEFAULT 0,
      exif_keys TEXT[],
      timestamp_source TEXT,
      gps_source TEXT,
      overlay_app TEXT,
      overlay_latitude DECIMAL(10, 8),
      overlay_longitude DECIMAL(11, 8),
      overlay_address TEXT,
      overlay_taken_at TIMESTAMP,
      overlay_found BOOLEAN DEFAULT FALSE,
      overlay_detected BOOLEAN DEFAULT FALSE,
      category INTEGER,
      has_duplicate BOOLEAN DEFAULT FALSE,
      duplicate_of_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_photo_metadata_location ON photo_metadata(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_photo_metadata_has_gps ON photo_metadata(has_gps);
    CREATE INDEX IF NOT EXISTS idx_photo_metadata_has_duplicate ON photo_metadata(has_duplicate);

    CREATE TABLE IF NOT EXISTS photo_analyses (
      id SERIAL PRIMARY KEY,
      photo_id TEXT NOT NULL REFERENCES photo_metadata(id) ON DELETE CASCADE,
      path_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      analyzed_at TIMESTAMP,
      error TEXT,
      result JSONB,

      -- Gemini analysis fields (GeminiAnalysis / util path)
      has_trench BOOLEAN,
      has_trench_confidence INTEGER,
      has_vertical_measuring_stick BOOLEAN,
      has_vertical_measuring_stick_confidence INTEGER,
      has_address_sheet BOOLEAN,
      has_address_sheet_confidence INTEGER,
      has_sand_bedding BOOLEAN,
      has_sand_bedding_confidence INTEGER,
      has_tape BOOLEAN,
      has_tape_confidence INTEGER,
      depth_cm DECIMAL(8, 2),
      depth_cm_confidence INTEGER,
      gps_present BOOLEAN,
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      address_present BOOLEAN,
      address TEXT,
      datetime_present BOOLEAN,
      datetime TIMESTAMP,

      -- Auditability
      prompt TEXT,
      output_text TEXT,

      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(photo_id, path_id)
    );

    CREATE TABLE IF NOT EXISTS photo_analysis_addresses (
      id SERIAL PRIMARY KEY,
      photo_id TEXT NOT NULL,
      path_id TEXT NOT NULL,
      address TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(photo_id, path_id, position),
      FOREIGN KEY (photo_id, path_id)
        REFERENCES photo_analyses(photo_id, path_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_photo_analyses_photo_id ON photo_analyses(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_analyses_path_id ON photo_analyses(path_id);
    CREATE INDEX IF NOT EXISTS idx_photo_analysis_addresses_photo_path ON photo_analysis_addresses(photo_id, path_id);
  `;

  try {
    await query(migrationSQL);
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}