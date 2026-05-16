"use client";

import { useEffect, useState } from "react";
import UploadStatusBadge from "@/components/UploadStatusBadge";

const ITEMS = [
  { id: "upload", label: "Upload" },
  { id: "map",    label: "Map" },
  { id: "report", label: "Report" },
];

export default function NavBar() {
  const [active, setActive] = useState("upload");

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const update = () => {
      const mid = main.scrollTop + main.clientHeight * 0.45;
      let current = "upload";
      for (const { id } of ITEMS) {
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
    <header className="topnav">
      <div className="topnav-brand">
        <span className="brand-mark" />
        <span className="brand-name">öGIG QC</span>
      </div>

      <nav className="topnav-items">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`topnav-item ${active === item.id ? "active" : ""}`}
            onClick={() => scrollTo(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="topnav-end">
        <UploadStatusBadge />
      </div>
    </header>
  );
}
