"use client";

type PhotoLike = {
  hasGps: boolean;
  analysis?: {
    trench: boolean;
    measuringStick: boolean;
    isDuplicate: boolean;
  } | null;
};

type Props = { photos: PhotoLike[] };

const CATS = [
  { label: "Cat 1", desc: "Duct + Depth", color: "#16a34a" },
  { label: "Cat 2", desc: "Duct only",    color: "#d97706" },
  { label: "Cat 3", desc: "Depth only",   color: "#dc2626" },
  { label: "Cat 4", desc: "Suspect",      color: "#ea580c" },
];

function toRad(deg: number) {
  return ((deg - 90) * Math.PI) / 180;
}

function segment(cx: number, cy: number, ro: number, ri: number, start: number, end: number) {
  if (end - start >= 360) end = start + 359.999;
  const large = end - start > 180 ? 1 : 0;
  const osx = cx + ro * Math.cos(toRad(start));
  const osy = cy + ro * Math.sin(toRad(start));
  const oex = cx + ro * Math.cos(toRad(end));
  const oey = cy + ro * Math.sin(toRad(end));
  const iex = cx + ri * Math.cos(toRad(end));
  const iey = cy + ri * Math.sin(toRad(end));
  const isx = cx + ri * Math.cos(toRad(start));
  const isy = cy + ri * Math.sin(toRad(start));
  return `M ${osx} ${osy} A ${ro} ${ro} 0 ${large} 1 ${oex} ${oey} L ${iex} ${iey} A ${ri} ${ri} 0 ${large} 0 ${isx} ${isy} Z`;
}

export default function DonutChart({ photos }: Props) {
  const counts = [0, 0, 0, 0];
  for (const p of photos) {
    if (!p.analysis) continue;
    if (p.analysis.isDuplicate || !p.hasGps) { counts[3]++; continue; }
    if (p.analysis.trench && p.analysis.measuringStick) counts[0]++;
    else if (p.analysis.trench) counts[1]++;
    else if (p.analysis.measuringStick) counts[2]++;
    else counts[3]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <div className="donut-wrap">
        <div className="donut-empty">Results appear after analysis</div>
      </div>
    );
  }

  const cx = 100, cy = 100, ro = 82, ri = 54;
  let cursor = 0;
  const segs = counts.map((n, i) => {
    const deg = (n / total) * 360;
    const s = { start: cursor, end: cursor + deg, count: n, idx: i };
    cursor += deg;
    return s;
  });

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 200 200" className="donut-svg">
        {segs.map((s) =>
          s.count === 0 ? null : (
            <path
              key={s.idx}
              d={segment(cx, cy, ro, ri, s.start, s.end)}
              fill={CATS[s.idx].color}
              opacity={0.88}
            />
          )
        )}
        <text x="100" y="96" textAnchor="middle" className="donut-num">{total}</text>
        <text x="100" y="114" textAnchor="middle" className="donut-sub">analysed</text>
      </svg>

      <div className="donut-legend">
        {CATS.map((cat, i) =>
          counts[i] > 0 ? (
            <div key={i} className="donut-row">
              <span className="donut-dot" style={{ background: cat.color }} />
              <span className="donut-label">{cat.label}</span>
              <span className="donut-desc">{cat.desc}</span>
              <span className="donut-count">{counts[i]}</span>
              <span className="donut-pct">{Math.round((counts[i] / total) * 100)}%</span>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
