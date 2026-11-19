import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa";
import { SITE_NAME, shareMeta, siteUrl } from "@/server/share-meta";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: SITE_NAME,
  ...shareMeta(SITE_NAME, "Το σύστημα του Nido Village για παραγγελίες, ταμείο και κρατήσεις."),
  manifest: "/manifest.webmanifest",
  applicationName: "Nido Village",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Nido" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f4f1e8",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-surface text-ink">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
