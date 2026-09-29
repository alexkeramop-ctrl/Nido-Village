/**
 * Το «πακέτο» στατιστικών που βλέπουν οι συνεταίροι online.
 * Υπολογίζεται στο κατάστημα και στέλνεται στο cloud (ή υπολογίζεται επιτόπου αν όλα τρέχουν στο cloud).
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listIngredients } from "@/server/services/inventory";
import { addDays, salesByCategory, salesByEmployee, salesByProduct, salesSummary, todayAthens, todayDashboard } from "@/server/services/reports";
import { getSettings } from "@/server/services/settings";
import { listStations } from "@/server/services/printers";

export type Snapshot = {
  version: 1;
  computedAt: string;
  venueName: string;
  today: Awaited<ReturnType<typeof salesSummary>>;
  yesterday: Awaited<ReturnType<typeof salesSummary>>;
  mtd: Awaited<ReturnType<typeof salesSummary>>;
  last30: Awaited<ReturnType<typeof salesSummary>>;
  topProducts30: Awaited<ReturnType<typeof salesByProduct>>;
  byCategory30: Awaited<ReturnType<typeof salesByCategory>>;
  byEmployee30: Awaited<ReturnType<typeof salesByEmployee>>;
  live: { openSessions: number; openCents: number; pendingKitchen: number };
  stock: { lowCount: number; valueCents: number; low: { name: string; stock: number; min: number; unit: string }[] };
  printers: { name: string; ok: boolean; lastError: string | null }[];
};

export async function computeSnapshot(): Promise<Snapshot> {
  const today = todayAthens();
  const yesterday = addDays(today, -1);
  const monthStart = today.slice(0, 8) + "01";
  const from30 = addDays(today, -29);
  const [settings, t, y, mtd, last30, top, cat, emp, dash, ings, stations] = await Promise.all([
    getSettings(),
    salesSummary({ from: today, to: today }),
    salesSummary({ from: yesterday, to: yesterday }),
    salesSummary({ from: monthStart, to: today }),
    salesSummary({ from: from30, to: today }),
    salesByProduct({ from: from30, to: today }),
    salesByCategory({ from: from30, to: today }),
    salesByEmployee({ from: from30, to: today }),
    todayDashboard(),
    listIngredients(),
    listStations(false),
  ]);
  const low = ings.filter((i) => i.low);
  return {
    version: 1,
    computedAt: new Date().toISOString(),
    venueName: settings.venueName,
    today: t,
    yesterday: y,
    mtd,
    last30,
    topProducts30: top.slice(0, 20),
    byCategory30: cat,
    byEmployee30: emp,
    live: { openSessions: dash.openSessions, openCents: dash.openCents, pendingKitchen: dash.pendingKitchen },
    stock: {
      lowCount: low.length,
      valueCents: ings.reduce((n, i) => n + i.stockValueCents, 0),
      low: low.slice(0, 30).map((i) => ({ name: i.name, stock: i.stock, min: i.min, unit: i.unit })),
    },
    printers: stations.map((s) => ({ name: s.name, ok: !s.lastError, lastError: s.lastError })),
  };
}

/** Αποθηκεύει snapshot στη βάση (τοπικά ή στο cloud). Κρατά και ημερήσιο ιστορικό. */
export async function storeSnapshot(snap: Snapshot) {
  const db = await getDb();
  const computedAt = new Date(snap.computedAt);
  await db
    .insert(schema.statsSnapshots)
    .values({ key: "latest", payload: snap, computedAt })
    .onConflictDoUpdate({ target: schema.statsSnapshots.key, set: { payload: snap, computedAt, receivedAt: new Date() } });
  const dayKey = `day:${snap.today.range.from}`;
  const dayPayload = { day: snap.today.range.from, summary: snap.today };
  await db
    .insert(schema.statsSnapshots)
    .values({ key: dayKey, payload: dayPayload, computedAt })
    .onConflictDoUpdate({ target: schema.statsSnapshots.key, set: { payload: dayPayload, computedAt, receivedAt: new Date() } });
}

export async function getLatestSnapshot(): Promise<{ snapshot: Snapshot; receivedAt: Date } | null> {
  const db = await getDb();
  const row = await db.query.statsSnapshots.findFirst({ where: eq(schema.statsSnapshots.key, "latest") });
  if (!row) return null;
  return { snapshot: row.payload as Snapshot, receivedAt: row.receivedAt };
}

export async function getDailyHistory(limit = 90) {
  const db = await getDb();
  const rows = await db.query.statsSnapshots.findMany();
  return rows
    .filter((r) => r.key.startsWith("day:"))
    .map((r) => r.payload as { day: string; summary: Snapshot["today"] })
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, limit);
}
