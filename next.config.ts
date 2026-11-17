import type { NextConfig } from "next";

// Build για Cloudflare Workers (npm run build:cf): χωρίς PGlite, η βάση είναι πάντα Postgres.
const cloudflare = process.env.NIDO_TARGET === "cloudflare";

const nextConfig: NextConfig = {
  serverExternalPackages: cloudflare ? ["pg", "iconv-lite"] : ["@electric-sql/pglite", "pg", "iconv-lite"],
  ...(cloudflare
    ? {
        turbopack: { resolveAlias: { "@/db/pglite-impl": "./src/db/pglite-impl.cloudflare.ts" } },
        webpack: (config: { resolve: { alias: Record<string, string> } }) => {
          config.resolve.alias["@/db/pglite-impl"] = new URL("./src/db/pglite-impl.cloudflare.ts", import.meta.url).pathname;
          return config;
        },
      }
    : {}),
  // Επιτρέπει πολλούς dev servers στον ίδιο φάκελο (π.χ. NEXT_DIST_DIR=.next-a).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typedRoutes: false,
  // Σε serverless (Vercel) τα migrations και η εικόνα του seed διαβάζονται από το δίσκο: να μπουν στο bundle.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*", "./src/db/seed-assets/**/*"] },
  // Ανέβασμα εικόνας χάρτη (έως 3MB) μέσω server action: το προεπιλεγμένο όριο είναι 1MB.
  // Συνημμένα τιμολογίων έως 10MB (/api/invoices/*): το proxy κρατά στη μνήμη έως 10MB από προεπιλογή και θα έκοβε το αρχείο.
  experimental: { serverActions: { bodySizeLimit: "4mb" }, proxyClientMaxBodySize: "12mb" },
};

export default nextConfig;
