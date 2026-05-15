"use client";

import Link from "next/link";
import { formatEta, useUpload } from "@/context/UploadProvider";

export default function UploadStatusBadge() {
  const { phase } = useUpload();
  if (phase.kind === "idle") return null;

  let pct = 0;
  let label = "";
  const indeterminate = phase.kind === "preparing" && !phase.extracting;

  if (phase.kind === "uploading") {
    pct = phase.pct * 100;
    label = `${Math.round(pct)}%`;
  } else if (phase.kind === "preparing") {
    if (phase.extracting && phase.extracting.total > 0) {
      pct = (phase.extracting.done / phase.extracting.total) * 100;
      label = `${phase.extracting.done}/${phase.extracting.total}`;
    } else {
      label = "…";
    }
  } else if (phase.kind === "processing") {
    pct = phase.total > 0 ? (phase.done / phase.total) * 100 : 0;
    const eta = formatEta(phase.etaMs);
    label = eta || `${phase.done}/${phase.total}`;
  } else if (phase.kind === "complete") {
    pct = 100;
    label = "✓";
  }

  return (
    <Link href="/upload" className="sidebar-upload-badge" title="Upload in progress">
      <div className={`sidebar-upload-ring ${phase.kind === "complete" ? "done" : ""} ${indeterminate ? "indeterminate" : ""}`}>
        <svg viewBox="0 0 36 36" className="sidebar-upload-svg">
          <circle cx="18" cy="18" r="15" className="sidebar-upload-track" />
          {!indeterminate && (
            <circle
              cx="18"
              cy="18"
              r="15"
              className="sidebar-upload-progress"
              strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
              strokeDashoffset="23.56"
            />
          )}
        </svg>
        <span className="sidebar-upload-label">{label}</span>
      </div>
    </Link>
  );
}
