import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { UploadProvider } from "@/context/UploadProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "APG Photo Audit",
  description: "AI-powered construction photo audit",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <UploadProvider>
          <div className="shell">
            <NavBar />
            <main>{children}</main>
          </div>
        </UploadProvider>
      </body>
    </html>
  );
}
