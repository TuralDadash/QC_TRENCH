"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import UploadStatusBadge from "@/components/UploadStatusBadge";

const ITEMS = [
  {
    href: "/",
    title: "Map",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 5.5l6-3 6 3 6-3v12l-6 3-6-3-6 3v-12z" />
        <path d="M7 2.5v12M13 5.5v12" />
      </svg>
    ),
  },
  {
    href: "/upload",
    title: "Upload",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13V4M6 7l4-4 4 4" />
        <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" />
      </svg>
    ),
  },
  {
    href: "/report",
    title: "Report",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="14" height="16" rx="2" />
        <path d="M7 7h6M7 10.5h6M7 14h4" />
      </svg>
    ),
  },
];

export default function NavBar() {
  const path = usePathname();

  return (
    <nav className="sidenav">
      <div className="nav-brand" />
      <div className="nav-items">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.title}
            className={`nav-item ${path === item.href ? "active" : ""}`}
          >
            {item.icon}
          </Link>
        ))}
      </div>
      <div className="nav-bottom">
        <UploadStatusBadge />
      </div>
    </nav>
  );
}
