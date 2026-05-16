"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

// Shape returned by the "backend" (alternative) path — mirrors PhotoAssessment
// in backend/app/vlm.py.
export type PhotoCategory = "green" | "yellow" | "red" | "cat4";

export type BackendAssessment = {
  category?: PhotoCategory;
  reason?: string | null;
  is_construction_photo: boolean;
  is_construction_photo_confidence: number;
  is_likely_ai_generated?: boolean;
  is_likely_ai_generated_confidence?: number;
  overall_confidence: number;
  duct: { visible: boolean; confidence: number; notes: string };
  depth: {
    ruler_visible: boolean;
    depth_value_cm: number | null;
    depth_range_cm: number[] | null;
    uncertain: boolean;
    confidence: number;
    notes: string;
  };
  sand_bedding: { status: "sand" | "uncertain" | "not_sand"; confidence: number };
  burnt_in_metadata: {
    gps_lat: number | null;
    gps_lon: number | null;
    timestamp_iso: string | null;
    raw_text: string;
    confidence: number;
  };
  address_label: { found: boolean; text: string | null; confidence: number };
  privacy_flags?: { faces_visible: boolean; license_plates_visible: boolean };
  pipe_end_seals?: {
    status: "sealed" | "unsealed" | "not_visible";
    confidence: number;
  };
};

export type AnalysisRun = {
  pathId: string;
  kind: "util" | "backend";
  analyzedAt: string | null;
  error: string | null;
  result: GeminiAnalysis | BackendAssessment | null;
};

// A selectable analysis path for the Process dropdown.
export type AnalysisPath = {
  id: string;
  label: string;
  kind: "util" | "backend";
};

export type Uploaded = {
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
  timestampSource:
    | "exif"
    | "gps"
    | "filename"
    | "mtime"
    | "overlay"
    | null;
  gpsSource: "exif" | "overlay" | null;
  overlayApp: string | null;
  overlayLatitude: number | null;
  overlayLongitude: number | null;
  overlayAddress: string | null;
  overlayTakenAt: string | null;
  overlayFound: boolean;
  overlayDetected: boolean;
  // Analysis runs keyed by path id; a photo can be analysed by several paths.
  analyses?: Record<string, AnalysisRun>;
};

export type Skipped = { name: string; reason: string };

export type UploadPhase =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | {
      kind: "preparing";
      message: string;
      extracting?: { archive: string; done: number; total: number };
    }
  | {
      kind: "processing";
      done: number;
      total: number;
      etaMs: number | null;
      startedAt: number;
    }
  | { kind: "complete" };

// Phase of the Gemini "Process" run — independent of the upload pipeline.
export type ProcessPhase =
  | { kind: "idle" }
  | {
      kind: "running";
      done: number;
      total: number;
      etaMs: number | null;
      startedAt: number;
    }
  | { kind: "complete" };

type StreamEvent =
  | { event: "phase"; phase: "preparing" }
  | { event: "extracting"; archive: string; done: number; total: number }
  | {
      event: "start";
      total: number;
      concurrency: number;
      droppedByLimit: number;
    }
  | { event: "processed"; done: number; total: number; record: Uploaded }
  | { event: "done"; skipped: Skipped[] }
  | { event: "error"; message: string };

type ProcessEvent =
  | { event: "start"; pathId: string; total: number }
  | {
      event: "analyzed";
      pathId: string;
      done: number;
      total: number;
      record: Uploaded;
    }
  | { event: "done"; pathId: string };

type ContextValue = {
  phase: UploadPhase;
  results: Uploaded[];
  skipped: Skipped[];
  processPhase: ProcessPhase;
  availablePaths: AnalysisPath[];
  startUpload: (
    files: File[],
    opts: { project?: string; lotId?: string; limit?: number | null },
  ) => void;
  startProcess: (pathId: string) => void;
  resetAll: () => Promise<void>;
  refresh: () => Promise<void>;
};

const UploadContext = createContext<ContextValue | null>(null);

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [results, setResults] = useState<Uploaded[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [processPhase, setProcessPhase] = useState<ProcessPhase>({
    kind: "idle",
  });
  const [availablePaths, setAvailablePaths] = useState<AnalysisPath[]>([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const processXhrRef = useRef<XMLHttpRequest | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/photos");
      const d = await r.json();
      setResults(d.photos || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Load the analysis paths: one per util/prompts file, plus the backend.
  useEffect(() => {
    (async () => {
      const backend: AnalysisPath = {
        id: "backend",
        label: "Alternative (backend)",
        kind: "backend",
      };
      try {
        const r = await fetch("/api/prompts");
        const d = await r.json();
        const prompts: string[] = d.prompts || [];
        const utilPaths: AnalysisPath[] = prompts.map((p) => ({
          id: `util:${p}`,
          label: `Gemini · ${p}`,
          kind: "util",
        }));
        setAvailablePaths([...utilPaths, backend]);
      } catch {
        setAvailablePaths([
          { id: "util:v1.txt", label: "Gemini · v1.txt", kind: "util" },
          backend,
        ]);
      }
    })();
  }, []);

  const resetAll = useCallback(async () => {
    await fetch("/api/photos", { method: "DELETE" });
    setResults([]);
    setSkipped([]);
  }, []);

  const startUpload = useCallback(
    (
      files: File[],
      opts: { project?: string; lotId?: string; limit?: number | null },
    ) => {
      if (files.length === 0) return;
      // Don't start a second upload while one is in-flight.
      if (xhrRef.current) return;

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
      if (opts.project) fd.append("project", opts.project);
      if (opts.lotId) fd.append("lotId", opts.lotId);
      if (opts.limit != null && opts.limit > 0)
        fd.append("limit", String(opts.limit));

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      let buffer = "";
      let lastLen = 0;
      let processingStart = 0;

      const drain = () => {
        const txt = xhr.responseText;
        const chunk = txt.slice(lastLen);
        lastLen = txt.length;
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      };

      const handleEvent = (ev: StreamEvent) => {
        if (ev.event === "phase" && ev.phase === "preparing") {
          setPhase({ kind: "preparing", message: "Preparing files…" });
        } else if (ev.event === "extracting") {
          setPhase({
            kind: "preparing",
            message: `Extracting ${ev.archive}`,
            extracting: {
              archive: ev.archive,
              done: ev.done,
              total: ev.total,
            },
          });
        } else if (ev.event === "start") {
          processingStart = performance.now();
          if (ev.droppedByLimit > 0) {
            setSkipped((prev) => [
              ...prev,
              {
                name: `(${ev.droppedByLimit} more)`,
                reason: "skipped due to benchmark limit",
              },
            ]);
          }
          setPhase({
            kind: "processing",
            done: 0,
            total: ev.total,
            etaMs: null,
            startedAt: processingStart,
          });
        } else if (ev.event === "processed") {
          setResults((prev) => [ev.record, ...prev]);
          setPhase(() => {
            const elapsed = performance.now() - processingStart;
            const avg = ev.done > 0 ? elapsed / ev.done : 0;
            const remaining = Math.max(0, ev.total - ev.done);
            const etaMs = avg > 0 && remaining > 0 ? avg * remaining : null;
            return {
              kind: "processing",
              done: ev.done,
              total: ev.total,
              etaMs,
              startedAt: processingStart,
            };
          });
        } else if (ev.event === "done") {
          setSkipped(ev.skipped || []);
        } else if (ev.event === "error") {
          // surface as a console warn; the phase will go back to idle below
          console.warn("upload error:", ev.message);
        }
      };

      xhr.open("POST", "/api/photos");
      xhr.upload.addEventListener("progress", (e) => {
        if (!e.lengthComputable) return;
        const pct = e.loaded / e.total;
        // Only update during the upload phase — once the server starts
        // emitting "preparing" or beyond, we don't want to clobber it.
        setPhase((p) =>
          p.kind === "uploading" ? { kind: "uploading", pct } : p,
        );
      });
      xhr.upload.addEventListener("load", () =>
        setPhase((p) =>
          p.kind === "uploading" ? { kind: "uploading", pct: 1 } : p,
        ),
      );
      xhr.addEventListener("progress", drain);
      xhr.addEventListener("load", () => {
        drain();
        xhrRef.current = null;
        setPhase({ kind: "complete" });
        setTimeout(
          () =>
            setPhase((p) => (p.kind === "complete" ? { kind: "idle" } : p)),
          1800,
        );
      });
      xhr.addEventListener("error", () => {
        xhrRef.current = null;
        setPhase({ kind: "idle" });
      });
      xhr.addEventListener("abort", () => {
        xhrRef.current = null;
        setPhase({ kind: "idle" });
      });
      xhr.send(fd);
    },
    [],
  );

  const startProcess = useCallback((pathId: string) => {
    // Don't start a second analysis run while one is in-flight.
    if (processXhrRef.current) return;

    setProcessPhase({
      kind: "running",
      done: 0,
      total: 0,
      etaMs: null,
      startedAt: performance.now(),
    });

    const xhr = new XMLHttpRequest();
    processXhrRef.current = xhr;

    let buffer = "";
    let lastLen = 0;
    let startedAt = performance.now();

    const handleEvent = (ev: ProcessEvent) => {
      if (ev.event === "start") {
        startedAt = performance.now();
        setProcessPhase({
          kind: "running",
          done: 0,
          total: ev.total,
          etaMs: null,
          startedAt,
        });
      } else if (ev.event === "analyzed") {
        setResults((prev) =>
          prev.map((r) => (r.id === ev.record.id ? ev.record : r)),
        );
        setProcessPhase(() => {
          const elapsed = performance.now() - startedAt;
          const avg = ev.done > 0 ? elapsed / ev.done : 0;
          const remaining = Math.max(0, ev.total - ev.done);
          const etaMs = avg > 0 && remaining > 0 ? avg * remaining : null;
          return {
            kind: "running",
            done: ev.done,
            total: ev.total,
            etaMs,
            startedAt,
          };
        });
      }
    };

    const drain = () => {
      const txt = xhr.responseText;
      const chunk = txt.slice(lastLen);
      lastLen = txt.length;
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let ev: ProcessEvent;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        handleEvent(ev);
      }
    };

    xhr.open("POST", `/api/process?path=${encodeURIComponent(pathId)}`);
    xhr.addEventListener("progress", drain);
    xhr.addEventListener("load", () => {
      drain();
      processXhrRef.current = null;
      setProcessPhase({ kind: "complete" });
      setTimeout(
        () =>
          setProcessPhase((p) =>
            p.kind === "complete" ? { kind: "idle" } : p,
          ),
        1800,
      );
    });
    xhr.addEventListener("error", () => {
      processXhrRef.current = null;
      setProcessPhase({ kind: "idle" });
    });
    xhr.addEventListener("abort", () => {
      processXhrRef.current = null;
      setProcessPhase({ kind: "idle" });
    });
    xhr.send();
  }, []);

  const value = useMemo<ContextValue>(
    () => ({
      phase,
      results,
      skipped,
      processPhase,
      availablePaths,
      startUpload,
      startProcess,
      resetAll,
      refresh,
    }),
    [
      phase,
      results,
      skipped,
      processPhase,
      availablePaths,
      startUpload,
      startProcess,
      resetAll,
      refresh,
    ],
  );

  return (
    <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
  );
}

export function useUpload() {
  const v = useContext(UploadContext);
  if (!v) throw new Error("useUpload must be used inside <UploadProvider>");
  return v;
}

export function formatEta(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, "0")}s left`;
}
