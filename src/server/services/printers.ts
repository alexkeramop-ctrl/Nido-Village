import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";
import { checkStationHealth, enqueue } from "@/server/printing/queue";
import { testTicket } from "@/server/printing/templates";
import type { Codepage, PrintDriver, PrintJobStatus, StationKind } from "@/db/schema";

export const STATION_KIND_LABEL: Record<StationKind, string> = { kitchen: "Κουζίνα", bar: "Μπαρ", receipt: "Ταμείο / Απόδειξη" };

export async function listStations(includeDisabled = true) {
  const db = await getDb();
  const rows = await db.query.printStations.findMany({ orderBy: [asc(schema.printStations.sort), asc(schema.printStations.id)] });
  return includeDisabled ? rows : rows.filter((s) => s.enabled);
}

export async function upsertStation(input: {
  id?: number;
  name: string;
  kind: StationKind;
  driver: PrintDriver;
  host?: string | null;
  port?: number;
  codepage?: Codepage;
  columns?: number;
  cutter?: boolean;
  drawerKick?: boolean;
  enabled?: boolean;
  sort?: number;
}) {
  const db = await getDb();
  const values = {
    name: input.name.trim(),
    kind: input.kind,
    driver: input.driver,
    host: input.driver === "tcp" ? (input.host ?? "").trim() || null : null,
    port: input.port ?? 9100,
    codepage: input.codepage ?? "cp737",
    columns: Math.min(64, Math.max(24, input.columns ?? 42)),
    cutter: input.cutter ?? true,
    drawerKick: input.drawerKick ?? false,
    enabled: input.enabled ?? true,
    sort: input.sort ?? 0,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα σταθμού");
  if (values.driver === "tcp" && !values.host) throw new Error("Απαιτείται διεύθυνση IP για εκτυπωτή δικτύου");
  const [row] = input.id
    ? await db.update(schema.printStations).set(values).where(eq(schema.printStations.id, input.id)).returning()
    : await db.insert(schema.printStations).values(values).returning();
  emit({ type: "catalog.changed" });
  return row;
}

export async function printTestPage(stationId: number) {
  const db = await getDb();
  const s = await db.query.printStations.findFirst({ where: eq(schema.printStations.id, stationId) });
  if (!s) throw new Error("Ο σταθμός δεν βρέθηκε");
  const job = await enqueue(db, stationId, "test", testTicket(s.name, s.columns));
  emit({ type: "print.changed" });
  return job;
}

export async function listPrintJobs(opts: { status?: PrintJobStatus; limit?: number } = {}) {
  const db = await getDb();
  return db.query.printJobs.findMany({
    where: opts.status ? eq(schema.printJobs.status, opts.status) : undefined,
    orderBy: [desc(schema.printJobs.id)],
    limit: opts.limit ?? 50,
    with: { station: true },
  });
}

export async function retryPrintJob(jobId: number) {
  const db = await getDb();
  await db
    .update(schema.printJobs)
    .set({ status: "queued", attempts: 0, lastError: null, nextAttemptAt: null })
    .where(eq(schema.printJobs.id, jobId));
  emit({ type: "print.changed" });
}

export async function cancelPrintJob(jobId: number) {
  const db = await getDb();
  await db.update(schema.printJobs).set({ status: "failed", lastError: "Ακυρώθηκε από χρήστη" }).where(eq(schema.printJobs.id, jobId));
  emit({ type: "print.changed" });
}

export { checkStationHealth };
