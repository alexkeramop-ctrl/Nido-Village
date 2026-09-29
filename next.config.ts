import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "iconv-lite"],
  // Επιτρέπει πολλούς dev servers στον ίδιο φάκελο (π.χ. NEXT_DIST_DIR=.next-a).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typedRoutes: false,
  // Σε serverless (Vercel) τα migrations και η εικόνα του seed διαβάζονται από το δίσκο: να μπουν στο bundle.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*", "./src/db/seed-assets/**/*"] },
  // Ανέβασμα εικόνας χάρτη (έως 3MB) μέσω server action: το προεπιλεγμένο όριο είναι 1MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
