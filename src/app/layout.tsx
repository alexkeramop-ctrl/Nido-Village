import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa";

export const metadata: Metadata = {
  title: "Nido Village",
  description: "Παραγγελιοληψία, ταμείο και αποθήκη",
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
