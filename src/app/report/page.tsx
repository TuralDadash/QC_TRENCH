"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PhotoAnalysis = {
  trench: boolean;
  measuringStick: boolean;
  sandBedding: boolean;
  warningTape: boolean;
  sideView: boolean;
  addressSheet: boolean;
  addresses: string[];
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
  analysis: PhotoAnalysis | null;
};

type Category = 1 | 2 | 3 | 4;

type CriterionKey = "trench" | "measuringStick" | "sandBedding" | "warningTape" | "sideView";

const CRITERIA: { key: CriterionKey; label: string }[] = [
  { key: "trench",        label: "Trench"    },
  { key: "measuringStick", label: "Depth"    },
  { key: "sandBedding",   label: "Sand"      },
  { key: "warningTape",   label: "Tape"      },
  { key: "sideView",      label: "Side view" },
];

const CAT_LABELS: Record<Category, string> = {
  1: "Cat 1 · Complete",
  2: "Cat 2 · Partial",
  3: "Cat 3 · Critical",
  4: "Cat 4 · Suspect",
};

const CAT_CLASSES: Record<Category, string> = {
  1: "cat1",
  2: "cat2",
  3: "cat3",
  4: "cat4",
};

function deriveCategory(p: Photo): Category {
  if (!p.analysis) return 2;
  if (p.analysis.isDuplicate || p.analysis.gpsOnSite === false) return 4;
  if (!p.hasGps) return 4;
  const allPass = CRITERIA.every((c) => p.analysis![c.key]);
  if (allPass) return 1;
  if (!p.analysis.trench || !p.analysis.sideView) return 3;
  return 2;
}

function whyFlagged(p: Photo): string[] {
  const reasons: string[] = [];
  if (!p.hasGps) reasons.push("Missing GPS coordinates");
  if (!p.analysis) return reasons;
  if (p.analysis.isDuplicate) {
    reasons.push(p.analysis.duplicateOf
      ? `Duplicate of ${p.analysis.duplicateOf}`
      : "Duplicate detected");
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
        lotId,
        project,
        total: 0,
        withGps: 0,
        analysed: 0,
        duplicates: 0,
        criteria: { trench: 0, measuringStick: 0, sandBedding: 0, warningTape: 0, sideView: 0 },
        passAll: 0,
        worstCat: 1,
        photos: [],
      });
    }

    const s = map.get(key)!;
    s.total++;
    s.photos.push(p);
    if (p.hasGps) s.withGps++;
    if (p.analysis) {
      s.analysed++;
      if (p.analysis.isDuplicate) s.duplicates++;
      for (const c of CRITERIA) {
        if (p.analysis[c.key]) s.criteria[c.key]++;
      }
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
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`status-dot ${ok ? "ok" : "err"}`} />;
}

type FilterKey = "all" | "failed" | "duplicate" | "no-gps" | "cat3" | "cat4";

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

export default function ReportPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    fetch("/api/photos")
      .then((r) => r.json())
      .then((d) => { setPhotos(d.photos || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const lots = buildReport(photos);
  const analysed = photos.filter((p) => p.analysis).length;
  const totalDups = photos.filter((p) => p.analysis?.isDuplicate).length;
  const totalPassAll = photos.filter((p) =>
    p.analysis && CRITERIA.every((c) => p.analysis![c.key])
  ).length;
  const totalFailed = photos.filter((p) => {
    const cat = deriveCategory(p);
    return cat === 3 || cat === 4;
  }).length;
  const totalNoGps = photos.filter((p) => !p.hasGps).length;

  function toggleLot(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filteredLots = lots.map((lot) => ({
    ...lot,
    photos: lot.photos.filter((p) => photoMatchesFilter(p, filter)),
  })).filter((lot) => lot.photos.length > 0);

  if (loading) {
    return (
      <div className="page-bg">
        <div className="empty">
          <div className="empty-card">
            <h2 className="empty-title">Preparing deficiency report</h2>
            <p className="empty-text">Loading uploaded photos and analysis signals…</p>
          </div>
        </div>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="page-bg">
        <div className="empty">
          <div className="empty-card">
            <h2 className="empty-title">No report data yet</h2>
            <p className="empty-text">
              Upload a photo batch first. This page will summarize lots, compliance signals,
              duplicates, and missing evidence.{" "}
              <Link href="/upload">Upload photos now →</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-bg">
      <div className="report-page">
        <div className="report-header">
          <div>
            <h1 className="page-title">Deficiency Report</h1>
            <p className="subtitle">
              {photos.length} photos · {lots.length} lot{lots.length === 1 ? "" : "s"} ·{" "}
              {analysed} analysed
            </p>
          </div>
          <div className="report-kpi-row">
            <div className="report-kpi-card ok">
              <div className="report-kpi-num">{totalPassAll}</div>
              <div className="report-kpi-label">Cat 1 · Pass</div>
            </div>
            <div className="report-kpi-card warn">
              <div className="report-kpi-num">{analysed - totalPassAll - totalFailed < 0 ? 0 : analysed - totalPassAll - totalFailed}</div>
              <div className="report-kpi-label">Cat 2 · Partial</div>
            </div>
            <div className="report-kpi-card err">
              <div className="report-kpi-num">{totalFailed}</div>
              <div className="report-kpi-label">Cat 3/4 · Failed</div>
            </div>
            <div className="report-kpi-card">
              <div className="report-kpi-num">{photos.length - analysed}</div>
              <div className="report-kpi-label">Not analysed</div>
            </div>
          </div>
        </div>

        <div className="filter-chips">
          {([
            { id: "all",       label: `All (${photos.length})`,         cls: "" },
            { id: "failed",    label: `Failed (${totalFailed})`,        cls: "err" },
            { id: "duplicate", label: `Duplicate (${totalDups})`,       cls: "cat4" },
            { id: "no-gps",    label: `No GPS (${totalNoGps})`,         cls: "warn" },
            { id: "cat3",      label: "Cat 3 · Critical",               cls: "err" },
            { id: "cat4",      label: "Cat 4 · Suspect",                cls: "cat4" },
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
          const hasIssues = lot.duplicates > 0 ||
            CRITERIA.some((c) => lot.criteria[c.key] < lot.analysed);
          const isCat4 = lot.worstCat === 4;

          return (
            <div key={key} className={`lot-card ${hasIssues ? "has-issues" : ""} ${isCat4 ? "cat4" : ""}`}>
              <div className="lot-header" onClick={() => toggleLot(key)}>
                <div className="lot-title">
                  <span className="lot-project">{lot.project}</span>
                  <span className="lot-sep">/</span>
                  <span className="lot-id">{lot.lotId}</span>
                  <span className={`cat-badge ${CAT_CLASSES[lot.worstCat]}`}>
                    {CAT_LABELS[lot.worstCat]}
                  </span>
                </div>
                <div className="lot-stats">
                  <span className="lot-stat">{lot.total} photo{lot.total === 1 ? "" : "s"}</span>
                  <span className={`lot-stat ${lot.withGps === lot.total ? "ok" : "warn"}`}>
                    {lot.withGps}/{lot.total} GPS
                  </span>
                  {lot.analysed > 0 && (
                    <span className={`lot-stat ${lot.passAll === lot.analysed ? "ok" : "err"}`}>
                      {lot.passAll}/{lot.analysed} pass all
                    </span>
                  )}
                  {lot.duplicates > 0 && (
                    <span className="lot-stat err">{lot.duplicates} dup</span>
                  )}
                </div>
                <div className="lot-criteria-row">
                  {CRITERIA.map((c) => (
                    <div key={c.key} className="lot-criterion">
                      <StatusDot ok={lot.analysed > 0 && lot.criteria[c.key] === lot.analysed} />
                      <span className="lot-criterion-label">{c.label}</span>
                      {lot.analysed > 0 && (
                        <span className="lot-criterion-pct">
                          {pct(lot.criteria[c.key], lot.analysed)}%
                        </span>
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
                          {p.takenAt && (
                            <div className="dim">{new Date(p.takenAt).toLocaleString()}</div>
                          )}
                          {flagged && <WhyFlagged p={p} />}
                          {flagged && <NextActions cat={cat} />}
                        </div>
                        <div className="lot-photo-criteria">
                          <span className={`cat-badge ${CAT_CLASSES[cat]}`}>{CAT_LABELS[cat]}</span>
                          {p.analysis ? CRITERIA.map((c) => (
                            <span
                              key={c.key}
                              className={`criterion-chip ${p.analysis![c.key] ? "ok" : "err"}`}
                              title={c.label}
                            >
                              {c.label}
                            </span>
                          )) : <span className="muted">—</span>}
                          {p.analysis?.isDuplicate && (
                            <span className="criterion-chip err">Duplicate</span>
                          )}
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
    </div>
  );
}
