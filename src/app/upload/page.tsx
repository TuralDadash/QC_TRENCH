"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  formatEta,
  useUpload,
  type Uploaded,
} from "@/context/UploadProvider";

type Mode = "files" | "folder" | "archive";

export default function UploadPage() {
  const { phase, results, skipped, startUpload, resetAll } = useUpload();

  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const archiveRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("files");
  const [project, setProject] = useState("");
  const [lotId, setLotId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

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
    startUpload(files, { project: project || undefined, lotId: lotId || undefined });
    setFiles([]);
    clearInputs();
  }

  async function doReset() {
    if (resetting) return;
    if (!window.confirm("Delete all uploaded photos and metadata? This cannot be undone.")) return;
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
    const noMeta = results.filter((r) => !r.hasExif && !r.overlayFound).length;
    return { total, withGps, noMeta };
  }, [results]);

  let barPct = 0;
  let primaryLabel = "";
  let secondaryLabel = "";
  const busy =
    phase.kind === "uploading" ||
    phase.kind === "preparing" ||
    phase.kind === "processing";
  const indeterminate = phase.kind === "preparing" && !phase.extracting;

  if (phase.kind === "uploading") {
    barPct = phase.pct * 100;
    primaryLabel = `Uploading ${Math.round(barPct)}%`;
    secondaryLabel = "Sending files to server";
  } else if (phase.kind === "preparing") {
    if (phase.extracting && phase.extracting.total > 0) {
      barPct = (phase.extracting.done / phase.extracting.total) * 100;
      primaryLabel = "Extracting archive";
      secondaryLabel = `${phase.extracting.done} / ${phase.extracting.total} — ${phase.extracting.archive}`;
    } else {
      primaryLabel = phase.message;
      secondaryLabel = "Server is reading the upload";
    }
  } else if (phase.kind === "processing") {
    barPct = phase.total > 0 ? (phase.done / phase.total) * 100 : 0;
    primaryLabel = `Processing ${phase.done} / ${phase.total}`;
    secondaryLabel = formatEta(phase.etaMs) || "Calculating…";
  } else if (phase.kind === "complete") {
    barPct = 100;
    primaryLabel = "Complete";
  }

  const dropLabel =
    mode === "folder"
      ? "Click to select a folder"
      : mode === "archive"
        ? "Click to select a .zip archive"
        : "Click or drag image files here";

  const preview = previewId ? results.find((r) => r.id === previewId) ?? null : null;

  return (
    <div className="page-bg">
      <div className="upload-page">
        <div className="page-card">
          <div className="upload-header">
            <div>
              <h1 className="page-title">Upload photos</h1>
              <p className="subtitle">
                Files, folder, or ZIP archive. GPS and overlay OCR are extracted automatically.
                You can leave this page — upload continues in the background.
              </p>
            </div>
          </div>

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

          <div className="field-row">
            <input
              placeholder="Project (optional)"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={busy}
            />
            <input
              placeholder="Lot ID (optional)"
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              disabled={busy}
            />
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
            <input ref={filesRef} type="file" multiple accept="image/*" onChange={(e) => pickFiles(e.target.files)} style={{ display: "none" }} />
            <input ref={folderRef} type="file" multiple onChange={(e) => pickFiles(e.target.files)} style={{ display: "none" }} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
            <input ref={archiveRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => pickFiles(e.target.files)} style={{ display: "none" }} />
            {files.length > 0 ? selectionSummary(mode, files) : dropLabel}
          </div>

          <div className="action-row">
            {phase.kind !== "idle" && (
              <div className="progress">
                <div className={`bar ${busy ? "active" : ""} ${phase.kind === "complete" ? "done" : ""} ${indeterminate ? "indeterminate" : ""}`}>
                  <div className="fill" style={indeterminate ? undefined : { width: `${barPct}%` }} />
                </div>
                <div className="progress-label">{primaryLabel}</div>
                {secondaryLabel && <div className="progress-sub">{secondaryLabel}</div>}
              </div>
            )}
            <button className="btn" onClick={submit} disabled={busy || files.length === 0}>
              {busy ? <><span className="spinner" />Working…</> : "Upload"}
            </button>
          </div>
        </div>

        {results.length > 0 && (
          <div className="results">
            <div className="summary">
              <span><strong>{summary.total}</strong> photo{summary.total === 1 ? "" : "s"}</span>
              <span className="ok">{summary.withGps} with GPS</span>
              <span className={summary.noMeta > 0 ? "err" : "muted"}>{summary.noMeta} no metadata</span>
              {skipped.length > 0 && <span className="err">{skipped.length} skipped</span>}
              <button type="button" className="btn-ghost" onClick={doReset} disabled={resetting}>
                {resetting ? "Resetting…" : "Reset all"}
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>File</th>
                  <th>GPS source</th>
                  <th>Overlay</th>
                  <th>Taken</th>
                  <th>Lat</th>
                  <th>Lon</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="thumb-btn" onClick={() => setPreviewId(r.id)}>
                        <img src={`/api/photos/${r.id}`} alt="" className="row-thumb" />
                      </button>
                    </td>
                    <td title={r.originalName}>
                      <div className="filename">{r.originalName}</div>
                      {r.width && r.height ? <div className="dim">{r.width}×{r.height}</div> : null}
                    </td>
                    <td>{renderGpsBadge(r)}</td>
                    <td>
                      {r.overlayApp || r.overlayDetected ? (
                        <>
                          <div className="dim">{r.overlayApp ?? "detected"}</div>
                          {r.overlayAddress && <div className="filename" title={r.overlayAddress}>{r.overlayAddress}</div>}
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      {r.takenAt ? (
                        <>
                          <div>{new Date(r.takenAt).toLocaleString()}</div>
                          <div className="dim">{tsLabel(r.timestampSource)}</div>
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className={r.hasGps ? "" : "muted"}>{r.latitude != null ? r.latitude.toFixed(5) : "—"}</td>
                    <td className={r.hasGps ? "" : "muted"}>{r.longitude != null ? r.longitude.toFixed(5) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {skipped.length > 0 && (
              <details className="skipped-details">
                <summary className="skipped-summary">Skipped ({skipped.length})</summary>
                <ul className="skipped-list">
                  {skipped.map((s, i) => <li key={i}>{s.name} — {s.reason}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreviewId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setPreviewId(null)}>×</button>
            <img src={`/api/photos/${preview.id}`} alt={preview.originalName} className="modal-img" />
            <div className="modal-meta">
              <div className="modal-title">{preview.originalName}</div>
              <div className="modal-row">
                {renderGpsBadge(preview)}
                {preview.overlayApp && <span className="badge ok">{preview.overlayApp}</span>}
              </div>
              {preview.takenAt && (
                <div className="dim">Taken: {new Date(preview.takenAt).toLocaleString()} · {tsLabel(preview.timestampSource)}</div>
              )}
              {preview.latitude != null && (
                <div className="dim">GPS: {preview.latitude.toFixed(6)}, {preview.longitude?.toFixed(6)} · {preview.gpsSource}</div>
              )}
              {preview.overlayAddress && (
                <div className="dim">Address: {preview.overlayAddress}</div>
              )}
              <div className="dim">
                {preview.width && preview.height ? `${preview.width}×${preview.height} · ` : ""}
                {formatSize(preview.size)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderGpsBadge(r: Uploaded) {
  if (r.gpsSource === "overlay") return <span className="badge ok" title={r.overlayApp ? `From ${r.overlayApp} overlay` : "From overlay OCR"}>GPS · overlay</span>;
  if (r.gpsSource === "exif") return <span className="badge warn" title="EXIF GPS (no overlay)">GPS · EXIF</span>;
  if (r.overlayDetected) return <span className="badge warn" title="Overlay detected but coordinates unreadable">overlay · unreadable</span>;
  if (r.hasExif) return <span className="badge warn" title={`${r.exifFieldCount} EXIF fields, no GPS`}>EXIF · no GPS</span>;
  return <span className="badge err">no metadata</span>;
}

function tsLabel(src: Uploaded["timestampSource"]) {
  switch (src) {
    case "overlay": return "overlay OCR";
    case "exif": return "EXIF";
    case "gps": return "GPS timestamp";
    case "filename": return "filename";
    case "mtime": return "file mtime";
    default: return "";
  }
}

function selectionSummary(mode: Mode, files: File[]) {
  if (mode === "archive") return `Archive: ${files[0].name} (${formatSize(files[0].size)})`;
  if (mode === "folder") {
    const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    return `Folder "${rel?.split("/")[0] ?? "(unknown)"}" — ${files.length} file(s)`;
  }
  return `${files.length} file(s) selected`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
