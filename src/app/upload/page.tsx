"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatEta,
  useUpload,
  type AnalysisPath,
  type AnalysisRun,
  type BackendAssessment,
  type GeminiAnalysis,
  type PhotoCategory,
  type Uploaded,
} from "@/context/UploadProvider";

type Mode = "files" | "folder" | "archive";

type PreviewTarget = { photoId: string; pathId: string | null };

type Row = { photo: Uploaded; run: AnalysisRun | null; rowKey: string };

export default function UploadPage() {
  const {
    phase,
    results,
    skipped,
    processPhase,
    availablePaths,
    startUpload,
    startProcess,
    resetAll,
  } = useUpload();

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
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [resetting, setResetting] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [sortByName, setSortByName] = useState(false);

  // Default the dropdown once the path list loads.
  useEffect(() => {
    if (selectedPath || availablePaths.length === 0) return;
    const def =
      availablePaths.find((p) => p.id === "util:v1.txt") ?? availablePaths[0];
    setSelectedPath(def.id);
  }, [availablePaths, selectedPath]);

  // Close preview on Escape.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

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
    const analyzed = results.filter(
      (r) => r.analyses && Object.keys(r.analyses).length > 0,
    ).length;
    return { total, withGps, exifNoGps, noMeta, withTime, analyzed };
  }, [results]);

  // One row per (photo, analysis run); photos with no run get a single empty
  // row. Sorting the photo list keeps a photo's rows contiguous.
  const rows = useMemo<Row[]>(() => {
    const photos = [...results];
    if (sortByName) {
      photos.sort((a, b) => a.originalName.localeCompare(b.originalName));
    }
    const out: Row[] = [];
    for (const photo of photos) {
      const runs = photo.analyses ? Object.values(photo.analyses) : [];
      if (runs.length === 0) {
        out.push({ photo, run: null, rowKey: `${photo.id}::none` });
      } else {
        runs.sort((a, b) => a.pathId.localeCompare(b.pathId));
        for (const run of runs) {
          out.push({ photo, run, rowKey: `${photo.id}::${run.pathId}` });
        }
      }
    }
    return out;
  }, [results, sortByName]);

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
    primaryLabel = `Analyzing — ${processPhase.done} / ${processPhase.total}`;
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

  const indeterminate = phase.kind === "preparing" && !phase.extracting;

  const dropLabel =
    mode === "folder"
      ? "Click to pick a folder of images"
      : mode === "archive"
        ? "Click to pick a .zip archive"
        : "Click or drop image files here";

  const previewPhoto = preview
    ? results.find((r) => r.id === preview.photoId) ?? null
    : null;
  const previewRun =
    previewPhoto && preview?.pathId
      ? previewPhoto.analyses?.[preview.pathId] ?? null
      : null;

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
        <select
          value={selectedPath}
          onChange={(e) => setSelectedPath(e.target.value)}
          disabled={busy || availablePaths.length === 0}
          title="Analysis path the Process run will use"
          style={selectStyle}
        >
          {availablePaths.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          className="btn"
          onClick={() => selectedPath && startProcess(selectedPath)}
          disabled={busy || results.length === 0 || !selectedPath}
          title="Analyze every photo not yet processed by the selected path"
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
                <th
                  className="sortable"
                  onClick={() => setSortByName((s) => !s)}
                  title="Sort by file name to group a photo's analysis paths"
                >
                  File {sortByName ? "▲" : "⇅"}
                </th>
                <th>Path</th>
                <th>Metadata</th>
                <th>Overlay</th>
                <th>Analysis</th>
                <th>Kategorie</th>
                <th>Taken</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ photo: r, run, rowKey }) => {
                const geo = displayCoords(r, run);
                return (
                  <tr key={rowKey}>
                    <td>
                      <button
                        type="button"
                        className="thumb-btn"
                        onClick={() =>
                          setPreview({
                            photoId: r.id,
                            pathId: run?.pathId ?? null,
                          })
                        }
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
                    <td>
                      {run ? (
                        <span
                          className={`badge ${run.kind === "backend" ? "neutral" : "off"}`}
                          title={run.pathId}
                        >
                          {shortPath(run.pathId)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{renderMetadataBadge(r)}</td>
                    <td>
                      {r.overlayApp || r.overlayDetected ? (
                        <>
                          <div className="dim">
                            {r.overlayApp ?? "detected"}
                          </div>
                          {r.overlayAddress ? (
                            <div
                              className="filename"
                              title={r.overlayAddress}
                            >
                              {r.overlayAddress}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{renderAnalysis(run)}</td>
                    <td>{renderCategoryBadge(run)}</td>
                    <td>
                      {r.takenAt ? (
                        <>
                          <div>{new Date(r.takenAt).toLocaleString()}</div>
                          <div className="dim">
                            {tsSourceLabel(r.timestampSource)}
                          </div>
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
                      {geo.fromAnalysis ? (
                        <div className="dim">analysis</div>
                      ) : null}
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

      {previewPhoto && (
        <div
          className="modal-backdrop"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setPreview(null)}
              aria-label="Close"
            >
              ×
            </button>
            <img
              src={`/api/photos/${previewPhoto.id}`}
              alt={previewPhoto.originalName}
              className="modal-img"
            />
            <div className="modal-meta">
              <div className="modal-title">{previewPhoto.originalName}</div>
              <div className="modal-row">
                {renderMetadataBadge(previewPhoto)}
                {previewPhoto.overlayApp ? (
                  <span className="badge ok" style={{ marginLeft: 8 }}>
                    {previewPhoto.overlayApp}
                  </span>
                ) : null}
              </div>
              {previewPhoto.takenAt ? (
                <div>
                  <strong>Taken:</strong>{" "}
                  {new Date(previewPhoto.takenAt).toLocaleString()}{" "}
                  <span className="dim">
                    ({tsSourceLabel(previewPhoto.timestampSource)})
                  </span>
                </div>
              ) : null}
              {previewPhoto.latitude != null &&
              previewPhoto.longitude != null ? (
                <div>
                  <strong>GPS:</strong> {previewPhoto.latitude.toFixed(6)},{" "}
                  {previewPhoto.longitude.toFixed(6)}{" "}
                  <span className="dim">
                    (source: {previewPhoto.gpsSource})
                  </span>
                </div>
              ) : null}
              {previewPhoto.overlayAddress ? (
                <div>
                  <strong>Overlay address:</strong>{" "}
                  {previewPhoto.overlayAddress}
                </div>
              ) : null}
              {preview?.pathId ? (
                <div className="dim">
                  Analysis path: {pathLabelOf(preview.pathId, availablePaths)}
                </div>
              ) : null}
              {renderAnalysisDetail(previewRun)}
              <div className="dim">
                {previewPhoto.width && previewPhoto.height
                  ? `${previewPhoto.width} × ${previewPhoto.height} · `
                  : ""}
                {formatSize(previewPhoto.size)}
                {previewPhoto.sourcePath &&
                previewPhoto.sourcePath !== previewPhoto.originalName
                  ? ` · ${previewPhoto.sourcePath}`
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

function flagBadge(label: string, on: boolean, title: string) {
  return (
    <span className={`badge ${on ? "ok" : "off"}`} title={title}>
      {label}
    </span>
  );
}

// --- Category cell ------------------------------------------------------

// Mirrors backend/app/classify.py for the Gemini util path. Gemini
// confidences are 0–100; classify.py's 0.4 threshold becomes 40 here.
const UTIL_VISIBLE_CONF_THRESHOLD = 40;

function categoryFromGemini(a: GeminiAnalysis): PhotoCategory {
  const ductOk =
    a.has_trench && a.has_trench_confidence >= UTIL_VISIBLE_CONF_THRESHOLD;
  const depthOk =
    a.has_vertical_measuring_stick &&
    a.has_vertical_measuring_stick_confidence >= UTIL_VISIBLE_CONF_THRESHOLD;
  if (ductOk && depthOk) return "green";
  if (ductOk) return "yellow";
  if (depthOk) return "red";
  return "cat4";
}

function categoryFromRun(
  run: AnalysisRun,
): { category: PhotoCategory; reason: string | null } | null {
  if (!run.result) return null;
  if (run.kind === "backend") {
    const a = run.result as BackendAssessment;
    if (!a.category) return null;
    return { category: a.category, reason: a.reason ?? null };
  }
  const a = run.result as GeminiAnalysis;
  return { category: categoryFromGemini(a), reason: null };
}

const CATEGORY_BADGE_CLASS: Record<PhotoCategory, string> = {
  green: "ok",
  yellow: "warn",
  red: "err",
  cat4: "off",
};

function renderCategoryBadge(run: AnalysisRun | null) {
  if (!run) return <span className="muted">—</span>;
  const c = categoryFromRun(run);
  if (!c) return <span className="muted">—</span>;
  return (
    <span
      className={`badge ${CATEGORY_BADGE_CLASS[c.category]}`}
      title={c.reason ?? undefined}
    >
      {c.category}
    </span>
  );
}

// --- Analysis cell (compact, table) -------------------------------------

function renderAnalysis(run: AnalysisRun | null) {
  if (!run) return <span className="muted">—</span>;
  if (run.error) {
    return (
      <span className="badge err" title={run.error}>
        failed
      </span>
    );
  }
  if (!run.result) return <span className="muted">—</span>;
  if (run.kind === "util") {
    return renderUtilCell(run.result as GeminiAnalysis);
  }
  return renderBackendCell(run.result as BackendAssessment);
}

function renderUtilCell(a: GeminiAnalysis) {
  return (
    <div className="analysis-cell">
      {flagBadge("trench", a.has_trench, `confidence ${a.has_trench_confidence}%`)}
      {flagBadge(
        "stick",
        a.has_vertical_measuring_stick,
        `confidence ${a.has_vertical_measuring_stick_confidence}%`,
      )}
      {flagBadge(
        "sheet",
        a.has_address_sheet,
        `confidence ${a.has_address_sheet_confidence}%`,
      )}
      {flagBadge(
        "sand",
        a.has_sand_bedding,
        `confidence ${a.has_sand_bedding_confidence}%`,
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

function renderBackendCell(a: BackendAssessment) {
  const pc = (c: number) => `confidence ${Math.round(c * 100)}%`;
  return (
    <div className="analysis-cell">
      {flagBadge("duct", a.duct.visible, pc(a.duct.confidence))}
      {flagBadge("ruler", a.depth.ruler_visible, pc(a.depth.confidence))}
      {flagBadge(
        "sand",
        a.sand_bedding.status === "sand",
        `${a.sand_bedding.status} · ${pc(a.sand_bedding.confidence)}`,
      )}
      {a.depth.depth_value_cm != null ? (
        <span className="badge neutral" title={pc(a.depth.confidence)}>
          {a.depth.depth_value_cm} cm
        </span>
      ) : null}
      {a.burnt_in_metadata.gps_lat != null &&
      a.burnt_in_metadata.gps_lon != null ? (
        <span
          className="badge neutral"
          title={`overlay GPS ${a.burnt_in_metadata.gps_lat.toFixed(5)}, ${a.burnt_in_metadata.gps_lon.toFixed(5)}`}
        >
          gps
        </span>
      ) : null}
      {a.is_likely_ai_generated ? (
        <span
          className="badge err"
          title={pc(a.is_likely_ai_generated_confidence ?? 0)}
        >
          AI?
        </span>
      ) : null}
    </div>
  );
}

// --- Analysis detail (modal) --------------------------------------------

function renderAnalysisDetail(run: AnalysisRun | null) {
  if (!run) return null;
  if (run.error) {
    return (
      <div className="err" style={{ fontSize: 12 }}>
        Analysis failed: {run.error}
      </div>
    );
  }
  if (!run.result) return null;
  if (run.kind === "util") {
    return renderUtilDetail(run.result as GeminiAnalysis);
  }
  return renderBackendDetail(run.result as BackendAssessment);
}

function renderUtilDetail(a: GeminiAnalysis) {
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

function renderBackendDetail(a: BackendAssessment) {
  const pct = (c: number) => `${Math.round(c * 100)}%`;
  const row = (label: string, on: boolean, confidence: number) => (
    <div className="modal-row">
      <span className={`badge ${on ? "ok" : "off"}`}>{on ? "yes" : "no"}</span>
      <span>
        {label} <span className="dim">({pct(confidence)} confidence)</span>
      </span>
    </div>
  );
  const m = a.burnt_in_metadata;
  return (
    <div className="analysis-detail">
      <strong>Backend assessment</strong>
      {row(
        "Construction photo",
        a.is_construction_photo,
        a.is_construction_photo_confidence,
      )}
      {row("Duct visible", a.duct.visible, a.duct.confidence)}
      {row("Ruler visible", a.depth.ruler_visible, a.depth.confidence)}
      <div className="modal-row">
        <span className="badge neutral">
          {a.depth.depth_value_cm != null
            ? `${a.depth.depth_value_cm} cm`
            : a.depth.depth_range_cm
              ? `${a.depth.depth_range_cm[0]}–${a.depth.depth_range_cm[1]} cm`
              : "—"}
        </span>
        <span>
          Trench depth{" "}
          <span className="dim">
            ({pct(a.depth.confidence)} confidence
            {a.depth.uncertain ? ", uncertain" : ""})
          </span>
        </span>
      </div>
      <div className="modal-row">
        <span
          className={`badge ${a.sand_bedding.status === "sand" ? "ok" : "off"}`}
        >
          {a.sand_bedding.status}
        </span>
        <span>
          Sand bedding{" "}
          <span className="dim">
            ({pct(a.sand_bedding.confidence)} confidence)
          </span>
        </span>
      </div>
      {a.is_likely_ai_generated !== undefined
        ? row(
            "AI-generated suspicion",
            a.is_likely_ai_generated,
            a.is_likely_ai_generated_confidence ?? 0,
          )
        : null}
      {a.pipe_end_seals ? (
        <div className="modal-row">
          <span
            className={`badge ${a.pipe_end_seals.status === "sealed" ? "ok" : "off"}`}
          >
            {a.pipe_end_seals.status}
          </span>
          <span>
            Pipe end seals{" "}
            <span className="dim">
              ({pct(a.pipe_end_seals.confidence)} confidence)
            </span>
          </span>
        </div>
      ) : null}
      {a.address_label.found && a.address_label.text ? (
        <div>
          <strong>Address label:</strong> {a.address_label.text}
        </div>
      ) : null}
      {m.gps_lat != null || m.timestamp_iso || m.raw_text ? (
        <div className="analysis-detail">
          <strong>Burnt-in metadata</strong>
          {m.gps_lat != null && m.gps_lon != null ? (
            <div>
              <strong>GPS:</strong> {m.gps_lat.toFixed(6)},{" "}
              {m.gps_lon.toFixed(6)}
            </div>
          ) : null}
          {m.timestamp_iso ? (
            <div>
              <strong>Taken:</strong> {m.timestamp_iso}
            </div>
          ) : null}
          {m.raw_text ? <div className="dim">{m.raw_text}</div> : null}
        </div>
      ) : null}
      {a.privacy_flags &&
      (a.privacy_flags.faces_visible ||
        a.privacy_flags.license_plates_visible) ? (
        <div className="dim">
          Privacy:{" "}
          {[
            a.privacy_flags.faces_visible && "faces",
            a.privacy_flags.license_plates_visible && "license plates",
          ]
            .filter(Boolean)
            .join(", ")}{" "}
          visible
        </div>
      ) : null}
    </div>
  );
}

// --- Helpers ------------------------------------------------------------

// Coordinates to show for a row: the upload pipeline's GPS (EXIF / overlay
// OCR) when present, otherwise the coordinates the analysis run extracted.
function displayCoords(
  r: Uploaded,
  run: AnalysisRun | null,
): {
  lat: number | null;
  lon: number | null;
  fromAnalysis: boolean;
  sourceLabel: string | null;
} {
  if (r.latitude != null && r.longitude != null) {
    return {
      lat: r.latitude,
      lon: r.longitude,
      fromAnalysis: false,
      sourceLabel: r.gpsSource ? `GPS from ${r.gpsSource}` : null,
    };
  }
  if (run?.result) {
    if (run.kind === "util") {
      const a = run.result as GeminiAnalysis;
      if (a.gps_present && a.latitude != null && a.longitude != null) {
        return {
          lat: a.latitude,
          lon: a.longitude,
          fromAnalysis: true,
          sourceLabel: `GPS from ${run.pathId}`,
        };
      }
    } else {
      const m = (run.result as BackendAssessment).burnt_in_metadata;
      if (m.gps_lat != null && m.gps_lon != null) {
        return {
          lat: m.gps_lat,
          lon: m.gps_lon,
          fromAnalysis: true,
          sourceLabel: `GPS from ${run.pathId}`,
        };
      }
    }
  }
  return { lat: null, lon: null, fromAnalysis: false, sourceLabel: null };
}

function shortPath(pathId: string) {
  return pathId.startsWith("util:") ? pathId.slice("util:".length) : pathId;
}

function pathLabelOf(pathId: string, paths: AnalysisPath[]) {
  return paths.find((p) => p.id === pathId)?.label ?? pathId;
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

const selectStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#0f1115",
  border: "1px solid #2c3340",
  borderRadius: 6,
  color: "#e7ebf0",
  fontSize: 13,
};
