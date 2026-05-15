"use client";

import Link from "next/link";
import { formatEta, useUpload } from "@/context/UploadProvider";

export default function UploadStatusBadge() {
  const { phase } = useUpload();
  if (phase.kind === "idle") return null;

  let pct = 0;
  let label = "";
  if (phase.kind === "uploading") {
    pct = phase.pct * 100;
    label = `Uploading ${Math.round(pct)}%`;
  } else if (phase.kind === "preparing") {
    if (phase.extracting && phase.extracting.total > 0) {
      pct = (phase.extracting.done / phase.extracting.total) * 100;
      label = `Extracting ${phase.extracting.done}/${phase.extracting.total}`;
    } else {
      pct = 0;
      label = phase.message;
    }
  } else if (phase.kind === "processing") {
    pct = phase.total > 0 ? (phase.done / phase.total) * 100 : 0;
    const eta = formatEta(phase.etaMs);
    label = `Processing ${phase.done}/${phase.total}${eta ? " · " + eta : ""}`;
  } else if (phase.kind === "complete") {
    pct = 100;
    label = "Complete";
  }

  const isIndeterminate =
    phase.kind === "preparing" && !phase.extracting;

  return (
    <Link href="/upload" className="topbar-progress" title="Go to upload page">
      <span className="topbar-progress-label">{label}</span>
      <span
        className={`topbar-progress-bar ${
          phase.kind === "complete" ? "done" : ""
        } ${isIndeterminate ? "indeterminate" : ""}`}
      >
        <span
          className="topbar-progress-fill"
          style={
            isIndeterminate ? undefined : { width: `${pct.toFixed(1)}%` }
          }
        />
      </span>
    </Link>
  );
}
