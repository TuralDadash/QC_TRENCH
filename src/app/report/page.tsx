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

type CriterionKey = "trench" | "measuringStick" | "sandBedding" | "warningTape" | "sideView";

const CRITERIA: { key: CriterionKey; label: string }[] = [
  { key: "trench", label: "Trench" },
  { key: "measuringStick", label: "Depth" },
  { key: "sandBedding", label: "Sand" },
  { key: "warningTape", label: "Tape" },
  { key: "sideView", label: "Side view" },
];

type LotSummary = {
  lotId: string;
  project: string;
  total: number;
  withGps: number;
  analysed: number;
  duplicates: number;
  criteria: Record<CriterionKey, number>;
  passAll: number;
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

export default function ReportPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  function toggleLot(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) return <div className="empty">Loading report...</div>;

  if (photos.length === 0) {
    return (
      <div className="empty">
        No photos uploaded yet. <Link href="/upload">Upload photos</Link> to generate a report.
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
        <div className="report-topstats">
          <div className="report-topstat ok">{totalPassAll}<span>Pass all</span></div>
          <div className="report-topstat err">{photos.length - totalPassAll - (photos.length - analysed)}<span>Fail</span></div>
          <div className="report-topstat warn">{totalDups}<span>Duplicates</span></div>
          <div className="report-topstat muted">{photos.length - analysed}<span>Not analysed</span></div>
        </div>
      </div>

      {lots.map((lot) => {
        const key = `${lot.project}::${lot.lotId}`;
        const isOpen = expanded.has(key);
        const hasIssues = lot.duplicates > 0 ||
          CRITERIA.some((c) => lot.criteria[c.key] < lot.analysed);

        return (
          <div key={key} className={`lot-card ${hasIssues ? "has-issues" : ""}`}>
            <div className="lot-header" onClick={() => toggleLot(key)}>
              <div className="lot-title">
                <span className="lot-project">{lot.project}</span>
                <span className="lot-sep">/</span>
                <span className="lot-id">{lot.lotId}</span>
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
                  <span className="lot-stat err">{lot.duplicates} duplicate{lot.duplicates === 1 ? "" : "s"}</span>
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
              <button className="lot-toggle">{isOpen ? "▲" : "▼"}</button>
            </div>

            {isOpen && (
              <div className="lot-photos">
                {lot.photos.map((p) => (
                  <div key={p.id} className={`lot-photo-row ${p.analysis?.isDuplicate ? "is-duplicate" : ""}`}>
                    <img src={`/api/photos/${p.id}`} alt="" className="lot-thumb" />
                    <div className="lot-photo-info">
                      <div className="lot-photo-name">{p.originalName}</div>
                      {p.takenAt && (
                        <div className="dim">{new Date(p.takenAt).toLocaleString()}</div>
                      )}
                    </div>
                    <div className="lot-photo-criteria">
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
                      {p.analysis?.isDuplicate && <span className="badge err">Dup</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
