/**
 * Ουρά εκτύπωσης. Οι εργασίες γράφονται στη βάση (print_jobs) και ένας worker
 * μέσα στη διεργασία του server τις στέλνει στους εκτυπωτές με επαναλήψεις.
 */
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/server/audit";
import { emit, subscribe } from "@/server/events";
import { buildEscpos } from "./escpos";
import { checkTcp, sendToPrinter } from "./drivers";
import { renderText, type TicketDoc } from "./ticket";
import type { PrintJobKind } from "@/db/schema";

const MAX_ATTEMPTS = 6;

export async function enqueue(db: DbLike, stationId: number, kind: PrintJobKind, doc: TicketDoc) {
  const station = await db.query.printStations.findFirst({ where: eq(schema.printStations.id, stationId) });
  if (!station) throw new Error(`Άγνωστος σταθμός εκτύπωσης ${stationId}`);
  const renderedText = renderText(doc, station.columns);
  const [job] = await db
    .insert(schema.printJobs)
    .values({ stationId, kind, payload: doc, renderedText, status: "queued" })
    .returning();
  return job;
}

/** Βρίσκει τον σταθμό απόδειξης/ταμείου (kind = receipt). */
export async function findReceiptStation(db: DbLike) {
  return db.query.printStations.findFirst({
    where: and(eq(schema.printStations.kind, "receipt"), eq(schema.printStations.enabled, true)),
    orderBy: [asc(schema.printStations.sort)],
  });
}

export async function processQueueOnce(): Promise<number> {
  const db = await getDb();
  const now = new Date();
  const jobs = await db.query.printJobs.findMany({
    where: and(
      eq(schema.printJobs.status, "queued"),
      or(isNull(schema.printJobs.nextAttemptAt), lte(schema.printJobs.nextAttemptAt, now)),
    ),
    orderBy: [asc(schema.printJobs.id)],
    limit: 20,
    with: { station: true },
  });
  let processed = 0;
  for (const job of jobs) {
    const station = job.station;
    if (!station.enabled) {
      await db
        .update(schema.printJobs)
        .set({ status: "failed", lastError: "Ο σταθμός είναι απενεργοποιημένος" })
        .where(eq(schema.printJobs.id, job.id));
      continue;
    }
    await db.update(schema.printJobs).set({ status: "printing" }).where(eq(schema.printJobs.id, job.id));
    const doc = job.payload as TicketDoc;
    const text = job.renderedText ?? renderText(doc, station.columns);
    try {
      const bytes = buildEscpos(doc, {
        codepage: station.codepage,
        columns: station.columns,
        cutter: station.cutter,
        drawerKick: station.drawerKick,
      });
      await sendToPrinter(
        station.driver === "tcp"
          ? { driver: "tcp", host: station.host ?? "127.0.0.1", port: station.port }
          : { driver: "console", name: station.name },
        bytes,
        text,
      );
      await db
        .update(schema.printJobs)
        .set({ status: "done", printedAt: new Date(), attempts: job.attempts + 1, lastError: null })
        .where(eq(schema.printJobs.id, job.id));
      await db
        .update(schema.printStations)
        .set({ lastOkAt: new Date(), lastError: null })
        .where(eq(schema.printStations.id, station.id));
      emit({ type: "printer.status", stationId: station.id, ok: true });
      processed++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      const failed = attempts >= MAX_ATTEMPTS;
      await db
        .update(schema.printJobs)
        .set({
          status: failed ? "failed" : "queued",
          attempts,
          lastError: message,
          nextAttemptAt: failed ? null : new Date(Date.now() + Math.min(60_000, 3000 * attempts)),
        })
        .where(eq(schema.printJobs.id, job.id));
      await db
        .update(schema.printStations)
        .set({ lastError: message })
        .where(eq(schema.printStations.id, station.id));
      emit({ type: "printer.status", stationId: station.id, ok: false });
    }
  }
  if (jobs.length) emit({ type: "print.changed" });
  return processed;
}

export async function checkStationHealth(stationId: number): Promise<boolean> {
  const db = await getDb();
  const s = await db.query.printStations.findFirst({ where: eq(schema.printStations.id, stationId) });
  if (!s) return false;
  if (s.driver !== "tcp") return true;
  const ok = await checkTcp(s.host ?? "127.0.0.1", s.port);
  await db
    .update(schema.printStations)
    .set(ok ? { lastOkAt: new Date(), lastError: null } : { lastError: "Δεν απαντά (TCP)" })
    .where(eq(schema.printStations.id, stationId));
  return ok;
}

type WorkerState = { timer?: NodeJS.Timeout; running: boolean; unsubscribe?: () => void };
const g = globalThis as unknown as { __nidoPrintWorker?: WorkerState };

export function startPrintWorker(intervalMs = 1500) {
  if (g.__nidoPrintWorker) return;
  const state: WorkerState = { running: false };
  g.__nidoPrintWorker = state;
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await processQueueOnce();
    } catch (e) {
      console.error("[print-worker]", e);
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(tick, intervalMs);
  state.timer.unref?.();
  state.unsubscribe = subscribe((e) => {
    if (e.type === "print.changed") void tick();
  });
  void tick();
}

export function stopPrintWorker() {
  const s = g.__nidoPrintWorker;
  if (!s) return;
  if (s.timer) clearInterval(s.timer);
  s.unsubscribe?.();
  g.__nidoPrintWorker = undefined;
}

/** Χρήσιμο για tests: τρέχει την ουρά μέχρι να αδειάσει. */
export async function drainQueue(maxRounds = 10) {
  for (let i = 0; i < maxRounds; i++) {
    const n = await processQueueOnce();
    if (n === 0) break;
  }
}

