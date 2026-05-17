import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { UploadProvider } from "@/context/UploadProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "öGIG AI QC",
  description: "AI-powered trench photo quality control",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Cormorant+Garamond:ital@1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <UploadProvider>
          <NavBar />
          <main>{children}</main>
        </UploadProvider>
      </body>
    </html>
  );
}
