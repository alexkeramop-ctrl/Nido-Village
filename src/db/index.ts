/**
 * Σύνδεση βάσης.
 *  - Με DATABASE_URL: PostgreSQL (π.χ. Supabase) μέσω node-postgres.
 *  - Χωρίς: PGlite (ενσωματωμένη Postgres) στον φάκελο .data/pglite.
 *  - PGLITE_DIR=memory: προσωρινή βάση στη μνήμη (tests).
 * Τα migrations εκτελούνται αυτόματα στην πρώτη σύνδεση.
 */
import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

type Holder = { db?: Db; promise?: Promise<Db> };
const g = globalThis as unknown as { __nidoDb?: Holder };
const holder: Holder = (g.__nidoDb ??= {});

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    // PG_SSL=require: TLS με επαλήθευση πιστοποιητικού. PG_SSL=no-verify: TLS χωρίς επαλήθευση (π.χ. pooler χωρίς CA).
    const sslMode = process.env.PG_SSL ?? (process.env.DATABASE_URL.includes("supabase") ? "no-verify" : "off");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      ssl: sslMode === "off" ? undefined : { rejectUnauthorized: sslMode !== "no-verify" },
    });
    const db = drizzle(pool, { schema, casing: "snake_case" });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  }
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
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (holder.db) return Promise.resolve(holder.db);
  if (!holder.promise) {
    holder.promise = connect().then((db) => {
      holder.db = db;
      return db;
    });
  }
  return holder.promise;
}

/** Μόνο για tests: πετάει την τρέχουσα σύνδεση ώστε να ξεκινήσει καθαρή βάση. */
export function resetDbForTests() {
  holder.db = undefined;
  holder.promise = undefined;
}

export { schema };
