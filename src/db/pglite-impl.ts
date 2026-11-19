/** Ενσωματωμένη Postgres (PGlite) για τοπική χρήση χωρίς DATABASE_URL. Δεν χρησιμοποιείται στο Cloudflare. */
import fs from "node:fs";
import path from "node:path";

type Opts = { schema: Record<string, unknown>; migrationsFolder: string; migrateWithRetry: (run: () => Promise<void>) => Promise<void> };

export async function connectPglite({ schema, migrationsFolder, migrateWithRetry }: Opts) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // Σε serverless (Vercel) ο δίσκος είναι μόνο για ανάγνωση: χωρίς DATABASE_URL, βάση στη μνήμη (demo).
  const serverless = !!process.env.VERCEL;
  const dir = process.env.PGLITE_DIR ?? (serverless ? "memory" : path.join(process.cwd(), ".data", "pglite"));
  if (serverless && dir === "memory") {
    console.warn("[nido] Δεν υπάρχει DATABASE_URL: χρήση προσωρινής βάσης στη μνήμη (τα δεδομένα μηδενίζονται σε κάθε νέα εκκίνηση).");
  }
  if (dir !== "memory") fs.mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrateWithRetry(() => migrate(db, { migrationsFolder }));
  return db;
}
