"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { formatEta, useUpload, type Uploaded } from "@/context/UploadProvider";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Mode = "files" | "folder" | "archive";
type PhaseStep = "idle" | "uploading" | "extracting" | "processing" | "complete";

type PhotoAnalysis = {
  trench: boolean;
  measuringStick: boolean;
  sandBedding: boolean;
  warningTape: boolean;
  sideView: boolean;
  isDuplicate: boolean;
  duplicateOf: string | null;
  gpsOnSite: boolean | null;
};

type Photo = {
  id: string;
  originalName: string;
  project?: string;
  lotId?: string;
  hasGps: boolean;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsSource: "exif" | "overlay" | null;
  size: number;
  analysis: PhotoAnalysis | null;
};

type Category = 1 | 2 | 3 | 4;
type CriterionKey = "trench" | "measuringStick" | "sandBedding" | "warningTape" | "sideView";
type FilterKey = "all" | "failed" | "duplicate" | "no-gps" | "cat3" | "cat4";

const UPLOAD_STEPS: { id: PhaseStep; label: string }[] = [
  { id: "uploading", label: "Uploading" },
  { id: "extracting", label: "Extracting" },
  { id: "processing", label: "Processing" },
  { id: "complete", label: "Complete" },
];

const STEP_ORDER: PhaseStep[] = ["uploading", "extracting", "processing", "complete"];

const CRITERIA: { key: CriterionKey; label: string }[] = [
  { key: "trench", label: "Duct" },
  { key: "measuringStick", label: "Depth" },
  { key: "sandBedding", label: "Sand" },
  { key: "warningTape", label: "Tape" },
  { key: "sideView", label: "Side view" },
];

const CAT_LABELS: Record<Category, string> = {
  1: "Cat 1 · Green",
  2: "Cat 2 · Yellow",
  3: "Cat 3 · Red",
  4: "Cat 4 · Suspect",
};

const CAT_CLASSES: Record<Category, string> = {
  1: "cat1",
  2: "cat2",
  3: "cat3",
  4: "cat4",
};

function currentStep(phase: ReturnType<typeof useUpload>["phase"]): PhaseStep {
  if (phase.kind === "uploading") return "uploading";
  if (phase.kind === "preparing") return phase.extracting ? "extracting" : "uploading";
  if (phase.kind === "processing") return "processing";
  if (phase.kind === "complete") return "complete";
  return "idle";
}

function deriveCategory(p: Photo): Category {
  if (!p.analysis) return 2;
  if (p.analysis.isDuplicate || p.analysis.gpsOnSite === false || !p.hasGps) return 4;
  if (p.analysis.trench && p.analysis.measuringStick) return 1;
  if (p.analysis.trench) return 2;
  if (p.analysis.measuringStick) return 3;
  return 4;
}

function whyFlagged(p: Photo): string[] {
  const reasons: string[] = [];
  if (!p.hasGps) reasons.push("Missing GPS coordinates");
  if (!p.analysis) return reasons;
  if (p.analysis.isDuplicate) {
    reasons.push(p.analysis.duplicateOf ? `Duplicate of ${p.analysis.duplicateOf}` : "Duplicate detected");
  }
  if (p.analysis.gpsOnSite === false) reasons.push("GPS location off-site");
  if (!p.analysis.trench) reasons.push("Trench not visible");
  if (!p.analysis.sideView) reasons.push("Side view missing");
  if (!p.analysis.measuringStick) reasons.push("Depth measurement missing");
  if (!p.analysis.sandBedding) reasons.push("Sand bedding not confirmed");
  if (!p.analysis.warningTape) reasons.push("Warning tape not visible");
  return reasons;
}

type LotSummary = {
  lotId: string;
  project: string;
  total: number;
  withGps: number;
  analysed: number;
  duplicates: number;
  criteria: Record<CriterionKey, number>;
  passAll: number;
  worstCat: Category;
  photos: Photo[];
};

function buildReport(photos: Photo[]): LotSummary[] {
  const map = new Map<string, LotSummary>();
  for (const p of photos) {
    const project = p.project ?? "(no project)";
    const lotId = p.lotId ?? "(no lot)";
    const key = `${project}::${lotId}`;
    if (!map.has(key)) {
      map.set(key, {
        lotId, project, total: 0, withGps: 0, analysed: 0, duplicates: 0,
        criteria: { trench: 0, measuringStick: 0, sandBedding: 0, warningTape: 0, sideView: 0 },
        passAll: 0, worstCat: 1, photos: [],
      });
    }
    const s = map.get(key)!;
    s.total++;
    s.photos.push(p);
    if (p.hasGps) s.withGps++;
    if (p.analysis) {
      s.analysed++;
      if (p.analysis.isDuplicate) s.duplicates++;
      for (const c of CRITERIA) { if (p.analysis[c.key]) s.criteria[c.key]++; }
      if (CRITERIA.every((c) => p.analysis![c.key])) s.passAll++;
    }
    const cat = deriveCategory(p);
    if (cat > s.worstCat) s.worstCat = cat;
  }
  return [...map.values()].sort((a, b) =>
    `${a.project}${a.lotId}`.localeCompare(`${b.project}${b.lotId}`)
  );
}

function pct(n: number, total: number) {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function photoMatchesFilter(p: Photo, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "no-gps") return !p.hasGps;
  if (filter === "duplicate") return p.analysis?.isDuplicate === true;
  const cat = deriveCategory(p);
  if (filter === "cat3") return cat === 3;
  if (filter === "cat4") return cat === 4;
  if (filter === "failed") return cat === 3 || cat === 4;
  return true;
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

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`status-dot ${ok ? "ok" : "err"}`} />;
}

function WhyFlagged({ p }: { p: Photo }) {
  const [open, setOpen] = useState(false);
  const reasons = whyFlagged(p);
  if (reasons.length === 0) return null;
  return (
    <div className="why-flagged">
      <button className="why-flagged-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "- " : "+ "} Why flagged ({reasons.length})
      </button>
      {open && (
        <div className="why-flagged-body">
          {reasons.map((r, i) => (
            <div key={i} className="why-flagged-item">
              <span className="why-flag-dot" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NextActions({ cat }: { cat: Category }) {
  const [requested, setRequested] = useState<string | null>(null);
  if (cat === 1) return null;
  const actions: { label: string; id: string }[] = [];
  if (cat === 3 || cat === 4) actions.push({ label: "Request re-upload", id: "reupload" });
  if (cat === 3 || cat === 4) actions.push({ label: "Manual review", id: "manual" });
  if (cat === 2) actions.push({ label: "Accept with note", id: "accept" });
  if (cat === 2) actions.push({ label: "Request re-upload", id: "reupload" });
  return (
    <div className="next-action-row">
      {actions.map((a) => (
        <button
          key={a.id}
          className="btn-sm"
          style={requested === a.id ? { background: "var(--ok-bg)", color: "var(--ok)", borderColor: "var(--ok-border)" } : undefined}
          onClick={() => setRequested(a.id)}
        >
          {requested === a.id ? "Done" : a.label}
        </button>
      ))}
    </div>
  );
}

export default function FlowPage() {
  const { phase, results: uploadedPhotos, skipped, startUpload, resetAll } = useUpload();
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

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"map" | "table">("map");
  const [tableFilter, setTableFilter] = useState<"all" | 1 | 2 | 3 | 4 | "no-gps" | "dup">("all");

  const mapSectionRef = useRef<HTMLElement>(null);
  const reportSectionRef = useRef<HTMLElement>(null);
  const prevAnalysedRef = useRef(0);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    if (!previewId && !mapExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewId(null);
        setMapExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, mapExpanded]);

  useEffect(() => {
    const load = () =>
      fetch("/api/photos")
        .then((r) => r.json())
        .then((d) => setPhotos(d.photos || []))
        .catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  const analysedCount = photos.filter((p) => p.analysis).length;

  useEffect(() => {
    let io: IntersectionObserver;
    const rafId = requestAnimationFrame(() => {
      const els = document.querySelectorAll<Element>("[data-reveal]");
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          }
        },
        { threshold: 0.08, rootMargin: "0px 0px -32px 0px" },
      );
      els.forEach((el) => io.observe(el));
    });
    return () => {
      cancelAnimationFrame(rafId);
      io?.disconnect();
    };
  }, [photos.length, analysedCount]);

  useEffect(() => {
    if (phase.kind === "complete") {
      setTimeout(() => {
        mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 800);
    }
  }, [phase.kind]);

  useEffect(() => {
    if (analysedCount > 0 && prevAnalysedRef.current === 0) {
      setTimeout(() => {
        reportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 500);
    }
    prevAnalysedRef.current = analysedCount;
  }, [analysedCount]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = main;
      const max = scrollHeight - clientHeight;
      setScrollProgress(max > 0 ? scrollTop / max : 0);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
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
    try { await resetAll(); } finally { setResetting(false); }
  }

  const busy = phase.kind === "uploading" || phase.kind === "preparing" || phase.kind === "processing";
  const indeterminate = phase.kind === "preparing" && !phase.extracting;
  const step = currentStep(phase);
  const stepIdx = STEP_ORDER.indexOf(step);

  let barPct = 0;
  let primaryLabel = "";
  let secondaryLabel = "";

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
    primaryLabel = `Complete — ${uploadedPhotos.length} photo${uploadedPhotos.length === 1 ? "" : "s"} processed`;
  }

  const uploadSummary = useMemo(() => ({
    total: uploadedPhotos.length,
    withGps: uploadedPhotos.filter((r) => r.hasGps).length,
    noMeta: uploadedPhotos.filter((r) => !r.hasExif && !r.overlayFound).length,
  }), [uploadedPhotos]);

  const dropLabel =
    mode === "folder" ? "Click to select a folder"
    : mode === "archive" ? "Click to select a .zip archive"
    : "Click or drag image files here";

  const preview = previewId ? uploadedPhotos.find((r) => r.id === previewId) ?? null : null;

  const lots = buildReport(photos);
  const totalPassAll = photos.filter((p) => p.analysis && CRITERIA.every((c) => p.analysis![c.key])).length;
  const totalFailed = photos.filter((p) => { const cat = deriveCategory(p); return cat === 3 || cat === 4; }).length;
  const totalDups = photos.filter((p) => p.analysis?.isDuplicate).length;
  const totalNoGps = photos.filter((p) => !p.hasGps).length;

  function toggleLot(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filteredLots = lots
    .map((lot) => ({ ...lot, photos: lot.photos.filter((p) => photoMatchesFilter(p, filter)) }))
    .filter((lot) => lot.photos.length > 0);

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ photos, lots, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qc-report-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="page-scroll-track">
        <svg className="page-scroll-svg" viewBox="0 0 9 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M4.5,2 L4.5,44 L7.5,56 L7.5,98" stroke="#dbeafe" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="page-scroll-fill" style={{ height: `calc(clamp(0%, ${(scrollProgress * 100).toFixed(2)}%, 100%) - 6px)` }} />
        <div
          className="page-scroll-dot"
          style={{ top: `clamp(4.5px, ${(scrollProgress * 100).toFixed(2)}%, calc(100% - 4.5px))` }}
        />
      </div>

      <section id="upload" className="section snap-section">
        <div className="section-line" />
        <div className="upload-grid">
          <div className="section-left">
            <span className="section-eyebrow" data-reveal>01 — Upload</span>
            <h1 className="section-heading" data-reveal data-d="1">Trench documentation.<br />AI-verified.</h1>
            <p className="section-sub" data-reveal data-d="2">Upload site photos. The system checks GPS coordinates, depth measurement, sand bedding, warning tape — and flags every non-compliant section instantly.</p>
          </div>
          <div>
        <div className="upload-card" data-reveal data-d="2">

          {phase.kind !== "idle" && (
            <div className="upload-phases">
              {UPLOAD_STEPS.map((s, i) => {
                const isDone = i < stepIdx;
                const isActive = (s.id === step && phase.kind !== "complete") || (s.id === "complete" && phase.kind === "complete");
                return (
                  <div key={s.id} className={`upload-phase-step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
                    {s.label}
                  </div>
                );
              })}
            </div>
          )}

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
              placeholder="Project name (optional)"
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
            onDragOver={(e) => { if (busy || mode !== "files") return; e.preventDefault(); setDragOver(true); }}
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
            {files.length > 0 ? (
              <>
                <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.5L10 7h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>
                <div className="dropzone-label">{selectionSummary(mode, files)}</div>
                <div className="dropzone-sub">Click to change selection</div>
              </>
            ) : (
              <>
                <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div className="dropzone-label">{dropLabel}</div>
                <div className="dropzone-sub">
                  {mode === "files" ? "JPEG, PNG, HEIC — GPS and overlay metadata extracted automatically" : ""}
                  {mode === "folder" ? "All image files inside the folder will be uploaded" : ""}
                  {mode === "archive" ? "ZIP containing image files" : ""}
                </div>
              </>
            )}
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
          </div>
        </div>

        <div className="upload-results">
          {uploadedPhotos.length > 0 && (
            <div className="results">
              <div className="summary">
                <span><strong>{uploadSummary.total}</strong> photo{uploadSummary.total === 1 ? "" : "s"}</span>
                <span className="ok">{uploadSummary.withGps} with GPS</span>
                <span className={uploadSummary.noMeta > 0 ? "err" : "muted"}>{uploadSummary.noMeta} no metadata</span>
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
                  {uploadedPhotos.map((r) => (
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
      </section>

      <section id="map" ref={mapSectionRef as React.RefObject<HTMLElement>} className="section snap-section">
        <span className="section-eyebrow" data-reveal>02 — Map &amp; Table</span>
        <h2 className="section-heading" data-reveal data-d="1">Network &amp; coverage.</h2>

        <div className="view-toggle" data-reveal data-d="2">
          <button className={`view-tab${viewMode === "map" ? " active" : ""}`} onClick={() => setViewMode("map")}>Map</button>
          <button className={`view-tab${viewMode === "table" ? " active" : ""}`} onClick={() => setViewMode("table")}>Table ({photos.length})</button>
        </div>

        {viewMode === "map" && (
          <div className="view-panel">
            <div className="flow-map-container">
              <MapView />
              <button className="map-expand-btn" onClick={() => setMapExpanded(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              Fullscreen
            </button>
            </div>
          </div>
        )}

        {viewMode === "table" && (
          <div className="view-panel" data-reveal data-d="3">
            <div className="filter-chips" style={{ marginBottom: 12 }}>
              {([
                { id: "all", label: `All (${photos.length})` },
                { id: 1, label: "Cat 1 · Green" },
                { id: 2, label: "Cat 2 · Yellow" },
                { id: 3, label: "Cat 3 · Red" },
                { id: 4, label: "Cat 4 · Suspect" },
                { id: "no-gps", label: `No GPS (${photos.filter(p => !p.hasGps).length})` },
                { id: "dup", label: `Duplicate (${photos.filter(p => p.analysis?.isDuplicate).length})` },
              ] as { id: typeof tableFilter; label: string }[]).map((f) => (
                <button key={String(f.id)} className={`filter-chip${tableFilter === f.id ? " active" : ""}`} onClick={() => setTableFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            {photos.length === 0 ? (
              <div className="empty-state"><strong>No photos yet</strong>Upload photos in step 01 to see them here.</div>
            ) : (
              <div className="pt-wrap">
                <table className="pt-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>File</th>
                      <th>Taken</th>
                      <th>Lot</th>
                      <th>GPS</th>
                      <th>Category</th>
                      <th>Duct</th>
                      <th>Depth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {photos
                      .filter((p) => {
                        if (tableFilter === "all") return true;
                        if (tableFilter === "no-gps") return !p.hasGps;
                        if (tableFilter === "dup") return p.analysis?.isDuplicate === true;
                        return deriveCategory(p) === tableFilter;
                      })
                      .map((p) => {
                        const cat = deriveCategory(p);
                        const catColors: Record<number, string> = { 1: "#16a34a", 2: "#b45309", 3: "#dc2626", 4: "#ea580c" };
                        const catLabels: Record<number, string> = { 1: "Cat 1", 2: "Cat 2", 3: "Cat 3", 4: "Cat 4" };
                        return (
                          <tr key={p.id}>
                            <td>
                              <img src={`/api/photos/${p.id}`} alt="" className="pt-thumb" onClick={() => setPreviewId(p.id)} />
                            </td>
                            <td>
                              <div className="filename">{p.originalName}</div>
                              {p.lotId && <div className="dim">{p.project} / {p.lotId}</div>}
                            </td>
                            <td className="dim">{p.takenAt ? new Date(p.takenAt).toLocaleDateString("de-AT") : "—"}</td>
                            <td className="dim">{p.lotId ?? "—"}</td>
                            <td>
                              {p.hasGps
                                ? <span className="badge ok">{p.latitude?.toFixed(4)}, {p.longitude?.toFixed(4)}</span>
                                : <span className="badge warn">No GPS</span>}
                            </td>
                            <td>
                              <span className="pt-cat">
                                <span className="pt-dot" style={{ background: catColors[cat] }} />
                                {catLabels[cat]}
                              </span>
                            </td>
                            <td>
                              {p.analysis ? (
                                <span className={`criterion-chip ${p.analysis.trench ? "ok" : "err"}`}>
                                  {p.analysis.trench ? "✓" : "✗"}
                                </span>
                              ) : <span className="dim">—</span>}
                            </td>
                            <td>
                              {p.analysis ? (
                                <span className={`criterion-chip ${p.analysis.measuringStick ? "ok" : "err"}`}>
                                  {p.analysis.measuringStick ? "✓" : "✗"}
                                </span>
                              ) : <span className="dim">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section id="report" ref={reportSectionRef as React.RefObject<HTMLElement>} className="section snap-section">
        <div>
            <span className="section-eyebrow" data-reveal>03 — Report</span>
            <h2 className="section-heading" data-reveal data-d="1">Deficiency report.</h2>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 12 }} data-reveal data-d="2">
              <p className="section-sub" style={{ margin: 0 }}>
                {photos.length} photos · {lots.length} lot{lots.length === 1 ? "" : "s"} · {analysedCount} analysed
              </p>
              {photos.length > 0 && (
                <button className="export-btn" onClick={exportJSON}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Export JSON
                </button>
              )}
            </div>
            <div className="report-kpi-row" data-reveal data-d="1">
              <div className="report-kpi-card ok">
                <div className="report-kpi-num">{totalPassAll}</div>
                <div className="report-kpi-label">Cat 1 · Duct + Depth</div>
              </div>
              <div className="report-kpi-card warn">
                <div className="report-kpi-num">{Math.max(0, analysedCount - totalPassAll - totalFailed)}</div>
                <div className="report-kpi-label">Cat 2 · Duct only</div>
              </div>
              <div className="report-kpi-card err">
                <div className="report-kpi-num">{totalFailed}</div>
                <div className="report-kpi-label">Cat 3/4 · Red / Suspect</div>
              </div>
              <div className="report-kpi-card">
                <div className="report-kpi-num">{photos.length - analysedCount}</div>
                <div className="report-kpi-label">Not analysed</div>
              </div>
            </div>

            <div className="filter-chips" data-reveal data-d="2">
              {([
                { id: "all", label: `All (${photos.length})`, cls: "" },
                { id: "failed", label: `Failed (${totalFailed})`, cls: "err" },
                { id: "duplicate", label: `Duplicate (${totalDups})`, cls: "cat4" },
                { id: "no-gps", label: `No GPS (${totalNoGps})`, cls: "warn" },
                { id: "cat3", label: "Cat 3 · Critical", cls: "err" },
                { id: "cat4", label: "Cat 4 · Suspect", cls: "cat4" },
              ] as { id: FilterKey; label: string; cls: string }[]).map((f) => (
                <button
                  key={f.id}
                  className={`filter-chip ${filter === f.id ? `active ${f.cls}` : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredLots.map((lot) => {
              const key = `${lot.project}::${lot.lotId}`;
              const isOpen = expanded.has(key);
              const hasIssues = lot.duplicates > 0 || CRITERIA.some((c) => lot.criteria[c.key] < lot.analysed);
              const isCat4 = lot.worstCat === 4;
              return (
                <div key={key} className={`lot-card ${hasIssues ? "has-issues" : ""} ${isCat4 ? "cat4" : ""}`}>
                  <div className="lot-header" onClick={() => toggleLot(key)}>
                    <div className="lot-title">
                      <span className="lot-project">{lot.project}</span>
                      <span className="lot-sep">/</span>
                      <span className="lot-id">{lot.lotId}</span>
                      <span className={`cat-badge ${CAT_CLASSES[lot.worstCat]}`}>{CAT_LABELS[lot.worstCat]}</span>
                    </div>
                    <div className="lot-stats">
                      <span className="lot-stat">{lot.total} photo{lot.total === 1 ? "" : "s"}</span>
                      <span className={`lot-stat ${lot.withGps === lot.total ? "ok" : "warn"}`}>{lot.withGps}/{lot.total} GPS</span>
                      {lot.analysed > 0 && (
                        <span className={`lot-stat ${lot.passAll === lot.analysed ? "ok" : "err"}`}>{lot.passAll}/{lot.analysed} pass all</span>
                      )}
                      {lot.duplicates > 0 && <span className="lot-stat err">{lot.duplicates} dup</span>}
                    </div>
                    <div className="lot-criteria-row">
                      {CRITERIA.map((c) => (
                        <div key={c.key} className="lot-criterion">
                          <StatusDot ok={lot.analysed > 0 && lot.criteria[c.key] === lot.analysed} />
                          <span className="lot-criterion-label">{c.label}</span>
                          {lot.analysed > 0 && (
                            <span className="lot-criterion-pct">{pct(lot.criteria[c.key], lot.analysed)}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <button className="lot-toggle">{isOpen ? "-" : "+"}</button>
                  </div>

                  {isOpen && (
                    <div className="lot-photos">
                      {lot.photos.map((p) => {
                        const cat = deriveCategory(p);
                        const flagged = cat >= 3;
                        return (
                          <div key={p.id} className={`lot-photo-row ${p.analysis?.isDuplicate ? "is-duplicate" : ""}`}>
                            <img src={`/api/photos/${p.id}`} alt="" className="lot-thumb" />
                            <div className="lot-photo-info">
                              <div className="lot-photo-name">{p.originalName}</div>
                              {p.takenAt && <div className="dim">{new Date(p.takenAt).toLocaleString()}</div>}
                              {flagged && <WhyFlagged p={p} />}
                              {flagged && <NextActions cat={cat} />}
                            </div>
                            <div className="lot-photo-criteria">
                              <span className={`cat-badge ${CAT_CLASSES[cat]}`}>{CAT_LABELS[cat]}</span>
                              {p.analysis ? CRITERIA.map((c) => (
                                <span key={c.key} className={`criterion-chip ${p.analysis![c.key] ? "ok" : "err"}`} title={c.label}>
                                  {c.label}
                                </span>
                              )) : <span className="muted">—</span>}
                              {p.analysis?.isDuplicate && <span className="criterion-chip err">Duplicate</span>}
                            </div>
                            <div className="lot-photo-flags">
                              {!p.hasGps && <span className="badge warn">No GPS</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        {photos.length === 0 && (
          <div className="empty-state"><strong>No photos yet</strong>Upload photos in step 01 — results appear here automatically.</div>
        )}
      </section>

      {mapExpanded && (
        <div className="map-fullscreen-modal" onClick={() => setMapExpanded(false)}>
          <div className="map-fullscreen-container" onClick={(e) => e.stopPropagation()}>
            <button className="map-fullscreen-close" onClick={() => setMapExpanded(false)}>×</button>
            <MapView />
          </div>
        </div>
      )}

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
              {preview.overlayAddress && <div className="dim">Address: {preview.overlayAddress}</div>}
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
