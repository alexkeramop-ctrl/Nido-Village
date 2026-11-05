/**
 * Σύνδεση βάσης.
 *  - Με DATABASE_URL: PostgreSQL (π.χ. Supabase) μέσω node-postgres.
 *  - Χωρίς: PGlite (ενσωματωμένη Postgres) στον φάκελο .data/pglite.
 *  - PGLITE_DIR=memory: προσωρινή βάση στη μνήμη (tests).
 * Τα migrations εκτελούνται αυτόματα στην πρώτη σύνδεση.
 */
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";
import { isWorker } from "@/server/cf";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

type Holder = { db?: Db; promise?: Promise<Db> };
const g = globalThis as unknown as { __nidoDb?: Holder };
const holder: Holder = (g.__nidoDb ??= {});

const migrationsFolder = path.join(process.cwd(), "drizzle");

/** Η διεύθυνση της Postgres: DATABASE_URL, ή ό,τι ορίζουν οι ενσωματώσεις του Vercel (Neon / Vercel Postgres). */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL_UNPOOLED || undefined;
}

/** Τα migrations μπορεί να τρέξουν ταυτόχρονα από πολλά στιγμιότυπα (serverless): επανάληψη σε σύγκρουση. */
async function migrateWithRetry(run: () => Promise<void>, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      await run();
      return;
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 500 * i + Math.random() * 500));
    }
  }
}

async function connect(): Promise<Db> {
  const url = databaseUrl();
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    // PG_SSL=require: TLS με επαλήθευση πιστοποιητικού. PG_SSL=no-verify: TLS χωρίς επαλήθευση (π.χ. pooler χωρίς CA).
    // Χωρίς PG_SSL: για Supabase "no-verify", αλλιώς ό,τι λέει το ίδιο το URL (π.χ. sslmode=require στο Neon).
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 3 : 5)),
      ssl: sslFor(url),
    });
    const db = drizzle(pool, { schema, casing: "snake_case" });
    await migrateWithRetry(() => migrate(db, { migrationsFolder }));
    return db as unknown as Db;
  }
  // PGlite σε ξεχωριστό module: στο build για Cloudflare αντικαθίσταται από stub (δεν χωράει στο Worker).
  const { connectPglite } = await import("@/db/pglite-impl");
  return connectPglite({ schema, migrationsFolder, migrateWithRetry }) as unknown as Db;
}

/** TLS προς την Postgres (ίδιοι κανόνες σε Node και Workers). */
function sslFor(url: string) {
  const sslMode = process.env.PG_SSL ?? (url.includes("supabase") ? "no-verify" : "off");
  return sslMode === "off" ? undefined : { rejectUnauthorized: sslMode !== "no-verify" };
}

/* ---------- Cloudflare Workers ----------
 * Μια σύνδεση ανά αίτημα (τα sockets δεν μοιράζονται μεταξύ αιτημάτων στα Workers).
 * Με binding HYPERDRIVE (προτείνεται) η σύνδεση γίνεται μέσω του Hyperdrive, αλλιώς απευθείας στο DATABASE_URL.
 * Τα migrations είναι ενσωματωμένα στον κώδικα (δεν υπάρχει δίσκος) και τρέχουν μία φορά ανά στιγμιότυπο.
 */
const workerDbs = new WeakMap<object, Promise<Db>>();
const workerState = { migrated: false, seedStarted: false };

async function connectWorker(): Promise<Db> {
  const { cfContext } = await import("@/server/cf");
  const { env } = await cfContext();
  const url = env.HYPERDRIVE?.connectionString ?? databaseUrl();
  if (!url) throw new Error("[nido] Λείπει η βάση: ορίστε binding HYPERDRIVE ή μεταβλητή DATABASE_URL στο Cloudflare.");
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 3),
    idleTimeoutMillis: 5000,
    ssl: env.HYPERDRIVE ? undefined : sslFor(url),
  });
  const db = drizzle(pool, { schema, casing: "snake_case" }) as unknown as Db;
  if (!workerState.migrated) {
    const { embeddedMigrations } = await import("./migrations.generated");
    const d = db as unknown as { dialect: { migrate: (m: unknown, s: unknown, c: unknown) => Promise<void> }; session: unknown };
    await migrateWithRetry(() => d.dialect.migrate(embeddedMigrations, d.session, { migrationsFolder: "" }));
    workerState.migrated = true;
  }
  return db;
}

/** Demo δεδομένα + πρώτος συνεταίρος, μία φορά ανά στιγμιότυπο (στη θέση του instrumentation). */
async function prepareWorker(db: Db) {
  if (workerState.seedStarted) return;
  workerState.seedStarted = true;
  try {
    const cloud = process.env.NIDO_MODE === "cloud";
    const seedFlag = process.env.NIDO_SEED_DEMO;
    if (cloud ? seedFlag === "1" : seedFlag !== "0") {
      const { seedDemo } = await import("./seed");
      const { sql } = await import("drizzle-orm");
      const did = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20260929)`);
        return seedDemo(tx as unknown as Db);
      });
      if (did) console.log("[nido] Φορτώθηκαν δεδομένα επίδειξης (PIN διαχειριστή: 1234)");
    }
    const { bootstrapPartnerFromEnv } = await import("@/server/services/partners");
    await bootstrapPartnerFromEnv();
  } catch (e) {
    workerState.seedStarted = false;
    throw e;
  }
}

async function getWorkerDb(): Promise<Db> {
  const { cfContext } = await import("@/server/cf");
  const { ctx } = await cfContext();
  let p = workerDbs.get(ctx);
  if (!p) {
    p = connectWorker();
    workerDbs.set(ctx, p);
    p.catch(() => workerDbs.delete(ctx));
  }
  const db = await p;
  await prepareWorker(db);
  return db;
}

export function getDb(): Promise<Db> {
  if (isWorker) return getWorkerDb();
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
