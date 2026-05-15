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

type StreamEvent =
  | { event: "phase"; phase: "preparing" }
  | { event: "extracting"; archive: string; done: number; total: number }
  | { event: "start"; total: number; concurrency: number }
  | { event: "processed"; done: number; total: number; record: Uploaded }
  | { event: "done"; skipped: Skipped[] }
  | { event: "error"; message: string };

type ContextValue = {
  phase: UploadPhase;
  results: Uploaded[];
  skipped: Skipped[];
  startUpload: (
    files: File[],
    opts: { project?: string; lotId?: string },
  ) => void;
  resetAll: () => Promise<void>;
  refresh: () => Promise<void>;
};

const UploadContext = createContext<ContextValue | null>(null);

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [results, setResults] = useState<Uploaded[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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

  const resetAll = useCallback(async () => {
    await fetch("/api/photos", { method: "DELETE" });
    setResults([]);
    setSkipped([]);
  }, []);

  const startUpload = useCallback(
    (files: File[], opts: { project?: string; lotId?: string }) => {
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

  const value = useMemo<ContextValue>(
    () => ({ phase, results, skipped, startUpload, resetAll, refresh }),
    [phase, results, skipped, startUpload, resetAll, refresh],
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
