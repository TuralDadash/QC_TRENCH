"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Uploaded = {
  id: string;
  originalName: string;
  size: number;
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
  timestampSource: "exif" | "gps" | "filename" | "mtime" | "overlay" | null;
  gpsSource: "exif" | "overlay" | null;
  overlayApp: string | null;
  overlayLatitude: number | null;
  overlayLongitude: number | null;
  overlayAddress: string | null;
  overlayTakenAt: string | null;
  overlayFound: boolean;
  overlayDetected: boolean;
};

type Skipped = { name: string; reason: string };
type Mode = "files" | "folder" | "archive";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "processing"; done: number; total: number }
  | { kind: "complete" };

type StreamEvent =
  | { event: "start"; total: number }
  | { event: "processed"; index: number; total: number; record: Uploaded }
  | { event: "done"; skipped: Skipped[] };

export default function UploadPage() {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const archiveRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("files");
  const [project, setProject] = useState("");
  const [lotId, setLotId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<Uploaded[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);

  // Load existing photos on mount so navigating to the map and back keeps state.
  useEffect(() => {
    fetch("/api/photos")
      .then((r) => r.json())
      .then((d) => setResults(d.photos || []))
      .catch(() => {});
  }, []);

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

  function uploadWithProgress(
    fd: FormData,
    onUploadPct: (pct: number) => void,
    onEvent: (ev: StreamEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let buffer = "";
      let lastLen = 0;

      const drain = () => {
        const txt = xhr.responseText;
        const chunk = txt.slice(lastLen);
        lastLen = txt.length;
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            onEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // skip malformed line
          }
        }
      };

      xhr.open("POST", "/api/photos");
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onUploadPct(e.loaded / e.total);
      });
      xhr.upload.addEventListener("load", () => onUploadPct(1));
      xhr.addEventListener("progress", drain);
      xhr.addEventListener("load", () => {
        drain();
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`HTTP ${xhr.status}`));
      });
      xhr.addEventListener("error", () => reject(new Error("network error")));
      xhr.send(fd);
    });
  }

  async function submit() {
    if (files.length === 0) return;
    setPhase({ kind: "uploading", pct: 0 });
    setSkipped([]);

    const fd = new FormData();
    files.forEach((f) => {
      fd.append("files", f);
      const rel = (f as File & { webkitRelativePath?: string })
        .webkitRelativePath;
      fd.append("paths", rel && rel.length > 0 ? rel : f.name);
      fd.append("mtimes", String(f.lastModified || 0));
    });
    if (project) fd.append("project", project);
    if (lotId) fd.append("lotId", lotId);

    const newRecords: Uploaded[] = [];

    try {
      await uploadWithProgress(
        fd,
        (pct) =>
          setPhase((p) => (p.kind === "uploading" ? { kind: "uploading", pct } : p)),
        (event) => {
          if (event.event === "start") {
            setPhase({ kind: "processing", done: 0, total: event.total });
          } else if (event.event === "processed") {
            newRecords.push(event.record);
            // Stream the record into the table immediately so the user sees it appear.
            setResults((prev) => [event.record, ...prev]);
            setPhase({
              kind: "processing",
              done: event.index,
              total: event.total,
            });
          } else if (event.event === "done") {
            setSkipped(event.skipped || []);
          }
        },
      );
      setPhase({ kind: "complete" });
      setFiles([]);
      clearInputs();
      setTimeout(() => setPhase({ kind: "idle" }), 1500);
    } catch (err) {
      setPhase({ kind: "idle" });
      alert("Upload failed: " + (err as Error).message);
    }
  }

  const summary = useMemo(() => {
    const total = results.length;
    const withGps = results.filter((r) => r.hasGps).length;
    const exifNoGps = results.filter((r) => r.hasExif && !r.hasGps).length;
    const noMeta = results.filter((r) => !r.hasExif).length;
    const withTime = results.filter((r) => r.takenAt).length;
    return { total, withGps, exifNoGps, noMeta, withTime };
  }, [results]);

  let barPct = 0;
  let label = "";
  if (phase.kind === "uploading") {
    barPct = phase.pct * 100;
    label = `Uploading ${Math.round(barPct)}%`;
  } else if (phase.kind === "processing") {
    barPct = phase.total > 0 ? (phase.done / phase.total) * 100 : 0;
    label = `Extracting metadata — ${phase.done} / ${phase.total}`;
  } else if (phase.kind === "complete") {
    barPct = 100;
    label = "Complete";
  }

  const busy = phase.kind === "uploading" || phase.kind === "processing";

  const dropLabel =
    mode === "folder"
      ? "Click to pick a folder of images"
      : mode === "archive"
        ? "Click to pick a .zip archive"
        : "Click or drop image files here";

  return (
    <div className="upload-page wide">
      <h1>Upload construction photos</h1>
      <p style={{ color: "#8a93a3", marginTop: -8 }}>
        Upload individual files, a whole folder, or a ZIP archive. Each image is
        scanned for EXIF metadata (GPS, timestamp, camera, lens, exposure) and
        added to the map.
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
        {phase.kind !== "idle" && (
          <div className="progress">
            <div
              className={`bar ${busy ? "active" : ""} ${phase.kind === "complete" ? "done" : ""}`}
            >
              <div className="fill" style={{ width: `${barPct}%` }} />
            </div>
            <div className="progress-label">{label}</div>
          </div>
        )}
        <button
          className="btn"
          onClick={submit}
          disabled={busy || files.length === 0}
        >
          {busy ? (
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
            {skipped.length > 0 && (
              <span className="err">{skipped.length} skipped</span>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th></th>
                <th>File</th>
                <th>Metadata</th>
                <th>Overlay</th>
                <th>Taken</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Camera / lens</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>
                    <img
                      src={`/api/photos/${r.id}`}
                      alt=""
                      className="row-thumb"
                    />
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
                  <td className={r.hasGps ? "" : "muted"}>
                    {r.latitude != null ? r.latitude.toFixed(5) : "—"}
                    {r.gpsAccuracy != null ? (
                      <div className="dim">±{r.gpsAccuracy.toFixed(1)} m</div>
                    ) : null}
                  </td>
                  <td className={r.hasGps ? "" : "muted"}>
                    {r.longitude != null ? r.longitude.toFixed(5) : "—"}
                    {r.altitude != null ? (
                      <div className="dim">{r.altitude.toFixed(0)} m alt</div>
                    ) : null}
                  </td>
                  <td>
                    <div>
                      {[r.cameraMake, r.cameraModel].filter(Boolean).join(" ") ||
                        "—"}
                    </div>
                    {r.lensModel ? <div className="dim">{r.lensModel}</div> : null}
                    {r.software ? <div className="dim">{r.software}</div> : null}
                  </td>
                  <td title={r.sourcePath}>
                    <div className="filename muted">
                      {r.sourcePath && r.sourcePath !== r.originalName
                        ? r.sourcePath
                        : "—"}
                    </div>
                    {formatExposure(r) !== "—" ? (
                      <div className="dim">{formatExposure(r)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
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
    </div>
  );
}

function renderMetadataBadge(r: Uploaded) {
  // Composite badge — overlay status (audit source) + EXIF status. The overlay
  // is the primary GPS signal; EXIF is the fallback.
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

function formatExposure(r: Uploaded) {
  const parts: string[] = [];
  if (r.focalLength != null) parts.push(`${r.focalLength}mm`);
  if (r.fNumber != null) parts.push(`f/${r.fNumber}`);
  if (r.exposureTime != null) {
    parts.push(
      r.exposureTime >= 1
        ? `${r.exposureTime}s`
        : `1/${Math.round(1 / r.exposureTime)}s`,
    );
  }
  if (r.iso != null) parts.push(`ISO${r.iso}`);
  return parts.length ? parts.join(" · ") : "—";
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
