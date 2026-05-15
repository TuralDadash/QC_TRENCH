import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "APG Photo Audit",
  description: "AI-powered construction photo audit prototype",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">APG Photo Audit</div>
          <nav>
            <Link href="/">Map</Link>
            <Link href="/upload">Upload</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
