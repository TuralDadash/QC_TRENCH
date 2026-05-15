import type { Metadata } from "next";
import Link from "next/link";
import { UploadProvider } from "@/context/UploadProvider";
import UploadStatusBadge from "@/components/UploadStatusBadge";
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
        <UploadProvider>
          <header className="topbar">
            <div className="brand">APG Photo Audit</div>
            <div className="topbar-right">
              <UploadStatusBadge />
              <nav>
                <Link href="/">Map</Link>
                <Link href="/upload">Upload</Link>
              </nav>
            </div>
          </header>
          <main>{children}</main>
        </UploadProvider>
      </body>
    </html>
  );
}
