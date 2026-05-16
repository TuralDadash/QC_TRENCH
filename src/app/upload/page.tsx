"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatEta,
  useUpload,
  type Uploaded,
} from "@/context/UploadProvider";

type Mode = "files" | "folder" | "archive";

export default function UploadPage() {
  const { phase, results, skipped, processPhase, startUpload, startProcess, resetAll } =
    useUpload();

  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const archiveRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("files");
  const [project, setProject] = useState("");
  const [lotId, setLotId] = useState("");
  // TEMP — benchmarking cap. Remove before the demo.
  const [limit, setLimit] = useState<number>(100);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Close preview on Escape.
  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId]);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list));
  }

  function clearInputs() {
    if (filesRef.current) filesRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
    if (archiveRef.current) archiveRef.current.value = "";
  }

  function changeMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setFiles([]);
    clearInputs();
  }

  function submit() {
    if (files.length === 0) return;
    startUpload(files, { project, lotId, limit });
    setFiles([]);
    clearInputs();
  }

  async function doReset() {
    if (resetting) return;
    if (
      !window.confirm(
        "Delete all uploaded photos and metadata? This cannot be undone.",
      )
    )
      return;
    setResetting(true);
    try {
      await resetAll();
    } finally {
      setResetting(false);
    }
  }

  const summary = useMemo(() => {
    const total = results.length;
    const withGps = results.filter((r) => r.hasGps).length;
    const exifNoGps = results.filter((r) => r.hasExif && !r.hasGps).length;
    const noMeta = results.filter((r) => !r.hasExif).length;
    const withTime = results.filter((r) => r.takenAt).length;
    const analyzed = results.filter((r) => r.analysis).length;
    return { total, withGps, exifNoGps, noMeta, withTime, analyzed };
  }, [results]);

  const processBusy = processPhase.kind === "running";

  // Drive the main progress bar from the global phase. The Gemini "Process"
  // run takes precedence — it never overlaps an upload.
  let barPct = 0;
  let primaryLabel = "";
  let secondaryLabel = "";
  if (processPhase.kind === "running") {
    barPct =
      processPhase.total > 0
        ? (processPhase.done / processPhase.total) * 100
        : 0;
    primaryLabel = `Analyzing with Gemini — ${processPhase.done} / ${processPhase.total}`;
    const eta = formatEta(processPhase.etaMs);
    secondaryLabel = eta || "Calculating remaining time…";
  } else if (processPhase.kind === "complete") {
    barPct = 100;
    primaryLabel = "Analysis complete";
    secondaryLabel = "";
  } else if (phase.kind === "uploading") {
    barPct = phase.pct * 100;
    primaryLabel = `Uploading ${Math.round(barPct)}%`;
    secondaryLabel = "Sending files to server";
  } else if (phase.kind === "preparing") {
    if (phase.extracting && phase.extracting.total > 0) {
      barPct = (phase.extracting.done / phase.extracting.total) * 100;
      primaryLabel = `Extracting archive`;
      secondaryLabel = `${phase.extracting.done} / ${phase.extracting.total} entries — ${phase.extracting.archive}`;
    } else {
      barPct = 0;
      primaryLabel = phase.message;
      secondaryLabel = "Server is reading the upload";
    }
  } else if (phase.kind === "processing") {
    barPct = phase.total > 0 ? (phase.done / phase.total) * 100 : 0;
    primaryLabel = `Extracting metadata — ${phase.done} / ${phase.total}`;
    const eta = formatEta(phase.etaMs);
    secondaryLabel = eta || "Calculating remaining time…";
  } else if (phase.kind === "complete") {
    barPct = 100;
    primaryLabel = "Complete";
    secondaryLabel = "";
  }

  const uploadBusy =
    phase.kind === "uploading" ||
    phase.kind === "preparing" ||
    phase.kind === "processing";

  const busy = uploadBusy || processBusy;

  const indeterminate =
    phase.kind === "preparing" && !phase.extracting;

  const dropLabel =
    mode === "folder"
      ? "Click to pick a folder of images"
      : mode === "archive"
        ? "Click to pick a .zip archive"
        : "Click or drop image files here";

  const preview = previewId ? results.find((r) => r.id === previewId) : null;

  return (
    <div className="upload-page wide">
      <h1>Upload construction photos</h1>
      <p style={{ color: "#8a93a3", marginTop: -8 }}>
        Upload individual files, a whole folder, or a ZIP archive. Each image
        is OCR-scanned for overlay metadata (GPS Map Camera and similar) and
        cross-checked against EXIF. You can navigate to the map while an
        upload is running — progress will keep going in the background.
      </p>

      <div className="seg">
        {(["files", "folder", "archive"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`seg-btn ${mode === m ? "active" : ""}`}
            onClick={() => changeMode(m)}
            disabled={busy}
          >
            {m === "files" ? "Files" : m === "folder" ? "Folder" : "Archive (.zip)"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <input
          placeholder="Project name (optional)"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={inputStyle}
          disabled={busy}
        />
        <input
          placeholder="Lot ID (optional)"
          value={lotId}
          onChange={(e) => setLotId(e.target.value)}
          style={inputStyle}
          disabled={busy}
        />
        <label
          title="TEMP: process at most this many images from the upload (for benchmarking)"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#8a93a3",
            border: "1px dashed rgba(245, 158, 11, 0.5)",
            borderRadius: 6,
            padding: "0 10px",
          }}
        >
          <span>TEMP · limit</span>
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
            disabled={busy}
            style={{
              width: 64,
              padding: "8px 6px",
              background: "#0f1115",
              border: "1px solid #2c3340",
              borderRadius: 4,
              color: "#e7ebf0",
            }}
          />
        </label>
      </div>

      <div
        className={`dropzone ${dragOver ? "dragover" : ""} ${busy ? "disabled" : ""}`}
        onClick={() => {
          if (busy) return;
          if (mode === "folder") folderRef.current?.click();
          else if (mode === "archive") archiveRef.current?.click();
          else filesRef.current?.click();
        }}
        onDragOver={(e) => {
          if (busy || mode !== "files") return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (busy || mode !== "files") return;
          e.preventDefault();
          setDragOver(false);
          pickFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => pickFiles(e.target.files)}
          style={{ display: "none" }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          onChange={(e) => pickFiles(e.target.files)}
          style={{ display: "none" }}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        <input
          ref={archiveRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={(e) => pickFiles(e.target.files)}
          style={{ display: "none" }}
        />
        {files.length > 0 ? selectionSummary(mode, files) : dropLabel}
      </div>

      <div className="action-row">
        {(phase.kind !== "idle" || processPhase.kind !== "idle") && (
          <div className="progress">
            <div
              className={`bar ${busy ? "active" : ""} ${phase.kind === "complete" || processPhase.kind === "complete" ? "done" : ""} ${indeterminate ? "indeterminate" : ""}`}
            >
              <div
                className="fill"
                style={indeterminate ? undefined : { width: `${barPct}%` }}
              />
            </div>
            <div className="progress-label">{primaryLabel}</div>
            {secondaryLabel ? (
              <div className="progress-sub">{secondaryLabel}</div>
            ) : null}
          </div>
        )}
        <button
          className="btn"
          onClick={() => startProcess()}
          disabled={busy || results.length === 0}
          title="Send every un-analyzed photo to Gemini for trench analysis"
        >
          {processBusy ? (
            <>
              <span className="spinner" /> Analyzing…
            </>
          ) : (
            "Process"
          )}
        </button>
        <button
          className="btn"
          onClick={submit}
          disabled={busy || files.length === 0}
        >
          {uploadBusy ? (
            <>
              <span className="spinner" /> Working…
            </>
          ) : (
            "Upload"
          )}
        </button>
      </div>

      {results.length > 0 && (
        <div className="results">
          <div className="summary">
            <span>
              <strong>{summary.total}</strong> photo
              {summary.total === 1 ? "" : "s"}
            </span>
            <span className="ok">{summary.withGps} with GPS</span>
            <span className={summary.exifNoGps > 0 ? "warn" : "muted"}>
              {summary.exifNoGps} EXIF without GPS
            </span>
            <span className={summary.noMeta > 0 ? "err" : "muted"}>
              {summary.noMeta} no metadata
            </span>
            <span className="muted">{summary.withTime} with timestamp</span>
            <span className={summary.analyzed > 0 ? "ok" : "muted"}>
              {summary.analyzed} analyzed
            </span>
            {skipped.length > 0 && (
              <span className="err">{skipped.length} skipped</span>
            )}
            <button
              type="button"
              className="btn-ghost danger"
              onClick={doReset}
              disabled={resetting || results.length === 0}
              style={{ marginLeft: "auto" }}
            >
              {resetting ? "Resetting…" : "Reset all"}
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th></th>
                <th>File</th>
                <th>Metadata</th>
                <th>Overlay</th>
                <th>Analysis</th>
                <th>Taken</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const geo = displayCoords(r);
                return (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className="thumb-btn"
                      onClick={() => setPreviewId(r.id)}
                      title="Click to enlarge"
                    >
                      <img
                        src={`/api/photos/${r.id}`}
                        alt=""
                        className="row-thumb"
                      />
                    </button>
                  </td>
                  <td title={r.originalName}>
                    <div className="filename">{r.originalName}</div>
                    {r.width && r.height ? (
                      <div className="dim">
                        {r.width} × {r.height}
                      </div>
                    ) : null}
                  </td>
                  <td>{renderMetadataBadge(r)}</td>
                  <td>
                    {r.overlayApp || r.overlayDetected ? (
                      <>
                        <div className="dim">{r.overlayApp ?? "detected"}</div>
                        {r.overlayAddress ? (
                          <div className="filename" title={r.overlayAddress}>
                            {r.overlayAddress}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{renderAnalysis(r)}</td>
                  <td>
                    {r.takenAt ? (
                      <>
                        <div>{new Date(r.takenAt).toLocaleString()}</div>
                        <div className="dim">{tsSourceLabel(r.timestampSource)}</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td
                    className={geo.lat != null ? "" : "muted"}
                    title={geo.sourceLabel ?? undefined}
                  >
                    {geo.lat != null ? geo.lat.toFixed(6) : "—"}
                    {geo.fromGemini ? <div className="dim">Gemini</div> : null}
                  </td>
                  <td
                    className={geo.lon != null ? "" : "muted"}
                    title={geo.sourceLabel ?? undefined}
                  >
                    {geo.lon != null ? geo.lon.toFixed(6) : "—"}
                  </td>
                  <td title={r.sourcePath}>
                    <div className="filename muted">
                      {r.sourcePath && r.sourcePath !== r.originalName
                        ? r.sourcePath
                        : "—"}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>

          {skipped.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", color: "#8a93a3" }}>
                Skipped entries ({skipped.length})
              </summary>
              <ul style={{ color: "#8a93a3", fontSize: 12 }}>
                {skipped.map((s, i) => (
                  <li key={i}>
                    {s.name} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {preview && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setPreviewId(null)}
              aria-label="Close"
            >
              ×
            </button>
            <img
              src={`/api/photos/${preview.id}`}
              alt={preview.originalName}
              className="modal-img"
            />
            <div className="modal-meta">
              <div className="modal-title">{preview.originalName}</div>
              <div className="modal-row">
                {renderMetadataBadge(preview)}
                {preview.overlayApp ? (
                  <span className="badge ok" style={{ marginLeft: 8 }}>
                    {preview.overlayApp}
                  </span>
                ) : null}
              </div>
              {preview.takenAt ? (
                <div>
                  <strong>Taken:</strong>{" "}
                  {new Date(preview.takenAt).toLocaleString()}{" "}
                  <span className="dim">
                    ({tsSourceLabel(preview.timestampSource)})
                  </span>
                </div>
              ) : null}
              {preview.latitude != null && preview.longitude != null ? (
                <div>
                  <strong>GPS:</strong> {preview.latitude.toFixed(6)},{" "}
                  {preview.longitude.toFixed(6)}{" "}
                  <span className="dim">(source: {preview.gpsSource})</span>
                </div>
              ) : null}
              {preview.overlayAddress ? (
                <div>
                  <strong>Overlay address:</strong> {preview.overlayAddress}
                </div>
              ) : null}
              {renderAnalysisDetail(preview)}
              <div className="dim">
                {preview.width && preview.height
                  ? `${preview.width} × ${preview.height} · `
                  : ""}
                {formatSize(preview.size)}
                {preview.sourcePath && preview.sourcePath !== preview.originalName
                  ? ` · ${preview.sourcePath}`
                  : ""}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderMetadataBadge(r: Uploaded) {
  if (r.gpsSource === "overlay") {
    return (
      <span
        className="badge ok"
        title={`Overlay parsed${r.overlayApp ? ` from ${r.overlayApp}` : ""}`}
      >
        GPS · overlay
      </span>
    );
  }
  if (r.gpsSource === "exif") {
    return (
      <span className="badge warn" title="No readable overlay — falling back to EXIF GPS">
        GPS · EXIF
      </span>
    );
  }
  if (r.overlayDetected) {
    return (
      <span
        className="badge warn"
        title="An overlay was detected on the image but its coordinates were not parseable from OCR"
      >
        overlay · unreadable
      </span>
    );
  }
  if (r.hasExif) {
    return (
      <span className="badge warn" title={`${r.exifFieldCount} EXIF fields, no GPS`}>
        EXIF · no GPS
      </span>
    );
  }
  return (
    <span className="badge err" title="No overlay, no EXIF — image has no extractable metadata">
      no metadata
    </span>
  );
}

function analysisFlag(label: string, on: boolean, confidence: number) {
  return (
    <span
      className={`badge ${on ? "ok" : "off"}`}
      title={`${on ? "detected" : "not detected"} · confidence ${confidence}%`}
    >
      {label}
    </span>
  );
}

function renderAnalysis(r: Uploaded) {
  if (r.analysis) {
    const a = r.analysis;
    return (
      <div className="analysis-cell">
        {analysisFlag("trench", a.has_trench, a.has_trench_confidence)}
        {analysisFlag(
          "stick",
          a.has_vertical_measuring_stick,
          a.has_vertical_measuring_stick_confidence,
        )}
        {analysisFlag(
          "sheet",
          a.has_address_sheet,
          a.has_address_sheet_confidence,
        )}
        {analysisFlag(
          "sand",
          a.has_sand_bedding,
          a.has_sand_bedding_confidence,
        )}
        {a.depth_cm != null ? (
          <span
            className="badge neutral"
            title={`depth confidence ${a.depth_cm_confidence}%`}
          >
            {a.depth_cm} cm
          </span>
        ) : null}
        {a.gps_present && a.latitude != null && a.longitude != null ? (
          <span
            className="badge neutral"
            title={`overlay GPS ${a.latitude.toFixed(5)}, ${a.longitude.toFixed(5)}`}
          >
            gps
          </span>
        ) : null}
      </div>
    );
  }
  if (r.analysisError) {
    return (
      <span className="badge err" title={r.analysisError}>
        failed
      </span>
    );
  }
  return <span className="muted">—</span>;
}

function renderAnalysisDetail(r: Uploaded) {
  if (r.analysisError) {
    return (
      <div className="err" style={{ fontSize: 12 }}>
        Gemini analysis failed: {r.analysisError}
      </div>
    );
  }
  if (!r.analysis) return null;
  const a = r.analysis;
  const row = (label: string, on: boolean, confidence: number) => (
    <div className="modal-row">
      <span className={`badge ${on ? "ok" : "off"}`}>{on ? "yes" : "no"}</span>
      <span>
        {label} <span className="dim">({confidence}% confidence)</span>
      </span>
    </div>
  );
  return (
    <div className="analysis-detail">
      <strong>Gemini analysis</strong>
      {row("Trench", a.has_trench, a.has_trench_confidence)}
      {row(
        "Vertical measuring stick",
        a.has_vertical_measuring_stick,
        a.has_vertical_measuring_stick_confidence,
      )}
      {row(
        "Address sheet",
        a.has_address_sheet,
        a.has_address_sheet_confidence,
      )}
      {row("Sand bedding", a.has_sand_bedding, a.has_sand_bedding_confidence)}
      <div className="modal-row">
        <span className="badge neutral">
          {a.depth_cm != null ? `${a.depth_cm} cm` : "—"}
        </span>
        <span>
          Trench depth{" "}
          <span className="dim">({a.depth_cm_confidence}% confidence)</span>
        </span>
      </div>
      {a.addresses.length > 0 ? (
        <div>
          <strong>Address sheet:</strong> {a.addresses.join(" · ")}
        </div>
      ) : null}
      {a.gps_present || a.address_present || a.datetime_present ? (
        <div className="analysis-detail">
          <strong>Geolocation overlay</strong>
          {a.gps_present && a.latitude != null && a.longitude != null ? (
            <div>
              <strong>GPS:</strong> {a.latitude.toFixed(6)},{" "}
              {a.longitude.toFixed(6)}
            </div>
          ) : null}
          {a.address_present && a.address ? (
            <div>
              <strong>Address:</strong> {a.address}
            </div>
          ) : null}
          {a.datetime_present && a.datetime ? (
            <div>
              <strong>Taken:</strong> {a.datetime}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Coordinates to show in the table: the upload pipeline's GPS (EXIF / overlay
// OCR) when present, otherwise the coordinates Gemini read off the overlay.
function displayCoords(r: Uploaded): {
  lat: number | null;
  lon: number | null;
  fromGemini: boolean;
  sourceLabel: string | null;
} {
  if (r.latitude != null && r.longitude != null) {
    return {
      lat: r.latitude,
      lon: r.longitude,
      fromGemini: false,
      sourceLabel: r.gpsSource ? `GPS from ${r.gpsSource}` : null,
    };
  }
  const a = r.analysis;
  if (a?.gps_present && a.latitude != null && a.longitude != null) {
    return {
      lat: a.latitude,
      lon: a.longitude,
      fromGemini: true,
      sourceLabel: "GPS from Gemini overlay analysis",
    };
  }
  return { lat: null, lon: null, fromGemini: false, sourceLabel: null };
}

function tsSourceLabel(source: Uploaded["timestampSource"]) {
  switch (source) {
    case "overlay":
      return "from overlay OCR";
    case "exif":
      return "from EXIF";
    case "gps":
      return "from GPS timestamp";
    case "filename":
      return "parsed from filename";
    case "mtime":
      return "from file mtime";
    default:
      return "";
  }
}

function selectionSummary(mode: Mode, files: File[]) {
  if (mode === "archive") {
    const f = files[0];
    return `Archive: ${f.name} (${formatSize(f.size)})`;
  }
  if (mode === "folder") {
    const rel = (files[0] as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    const top = rel?.split("/")[0];
    return `Folder “${top ?? "(unknown)"}” — ${files.length} file(s)`;
  }
  return `${files.length} file(s) ready to upload`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  background: "#0f1115",
  border: "1px solid #2c3340",
  borderRadius: 6,
  color: "#e7ebf0",
};
