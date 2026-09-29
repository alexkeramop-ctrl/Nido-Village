import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "iconv-lite"],
  // Επιτρέπει πολλούς dev servers στον ίδιο φάκελο (π.χ. NEXT_DIST_DIR=.next-a).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typedRoutes: false,
};

export default nextConfig;
