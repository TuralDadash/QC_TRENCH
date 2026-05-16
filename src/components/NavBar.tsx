"use client";

import { useEffect, useState } from "react";
import UploadStatusBadge from "@/components/UploadStatusBadge";

const STEPS = [
  { id: "upload", num: "01", label: "Upload" },
  { id: "report", num: "02", label: "Report" },
  { id: "map",    num: "03", label: "Map" },
];

export default function NavBar() {
  const [active, setActive] = useState("upload");

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const update = () => {
      const mid = main.scrollTop + main.clientHeight * 0.45;
      let current = "upload";
      for (const { id } of STEPS) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= mid) current = id;
      }
      setActive(current);
    };
    main.addEventListener("scroll", update, { passive: true });
    update();
    return () => main.removeEventListener("scroll", update);
  }, []);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="navbar">
      <a className="nav-brand" onClick={() => scrollTo("upload")}>
        <span className="nav-brand-name">öGIG QC</span>
      </a>

      <div className="nav-steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            className={`nav-step${active === s.id ? " active" : ""}`}
            onClick={() => scrollTo(s.id)}
          >
            <span className="nav-step-num">{s.num}</span>
            <span className="nav-step-label">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="nav-right">
        <UploadStatusBadge />
      </div>
    </nav>
  );
}
