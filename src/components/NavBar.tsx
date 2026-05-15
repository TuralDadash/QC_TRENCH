"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import UploadStatusBadge from "@/components/UploadStatusBadge";

const ITEMS = [
  {
    href: "/",
    label: "Map",
    step: "01",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 5.5l6-3 6 3 6-3v12l-6 3-6-3-6 3v-12z" />
        <path d="M7 2.5v12M13 5.5v12" />
      </svg>
    ),
  },
  {
    href: "/upload",
    label: "Upload",
    step: "02",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13V4M6 7l4-4 4 4" />
        <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" />
      </svg>
    ),
  },
  {
    href: "/report",
    label: "Report",
    step: "03",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="14" height="16" rx="2" />
        <path d="M7 7h6M7 10.5h6M7 14h4" />
      </svg>
    ),
  },
];

export default function NavBar() {
  const path = usePathname();

  return (
    <header className="topnav">
      <div className="topnav-brand">
        <div className="brand-mark" />
        <span className="brand-name">APG Audit</span>
      </div>

      <div className="topnav-divider" />

      <nav className="topnav-items">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`topnav-item ${path === item.href ? "active" : ""}`}
          >
            <span className="topnav-step">{item.step}</span>
            <span className="topnav-icon">{item.icon}</span>
            <span className="topnav-label">{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="topnav-end">
        <UploadStatusBadge />
      </div>
    </header>
  );
}
