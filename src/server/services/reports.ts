/**
 * Αναφορές πωλήσεων. Οι ημερομηνίες είναι σε Europe/Athens.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { computeTotals, lineTotalCents } from "./billing";
import { recipeCosts } from "./inventory";

const TZ = "Europe/Athens";

/** "2026-09-29" -> αρχή ημέρας Αθήνας ως Date (UTC instant). */
export function athensDayStart(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Βρίσκουμε το offset της Αθήνας για εκείνη την ημέρα.
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetMin = tzOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMin * 60000);
}

function tzOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function todayAthens(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DateRange = { from: string; to: string }; // inclusive ISO dates

async function closedSessions(range: DateRange) {
  const db = await getDb();
  const start = athensDayStart(range.from);
  const end = athensDayStart(addDays(range.to, 1));
  return db.query.tableSessions.findMany({
    where: and(eq(schema.tableSessions.status, "closed"), gte(schema.tableSessions.closedAt, start), lt(schema.tableSessions.closedAt, end)),
    with: {
      table: true,
      openedByEmployee: true,
      items: { with: { modifiers: true, product: { with: { category: true } } } },
      payments: true,
      orders: { with: { employee: true } },
    },
  });
}

export async function salesSummary(range: DateRange) {
  const sessions = await closedSessions(range);
  const byMethod: Record<string, number> = {};
  const byDay = new Map<string, { gross: number; count: number }>();
  const byHour = new Map<number, { gross: number; count: number }>();
  const vat = new Map<number, { net: number; vat: number; gross: number }>();
  let gross = 0;
  let discounts = 0;
  let covers = 0;
  let voidsCents = 0;
  let voidsCount = 0;
  for (const s of sessions) {
    const t = computeTotals(s.items, s.discountCents, s.payments);
    gross += t.totalCents;
    discounts += t.discountCents;
    covers += s.covers;
    for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountCents;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(s.closedAt!);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(s.closedAt!));
    const d = byDay.get(day) ?? { gross: 0, count: 0 };
    d.gross += t.totalCents;
    d.count++;
    byDay.set(day, d);
    const h = byHour.get(hour) ?? { gross: 0, count: 0 };
    h.gross += t.totalCents;
    h.count++;
    byHour.set(hour, h);
    for (const v of t.vat) {
      const e = vat.get(v.ratePct) ?? { net: 0, vat: 0, gross: 0 };
      e.net += v.netCents;
      e.vat += v.vatCents;
      e.gross += v.grossCents;
      vat.set(v.ratePct, e);
    }
    for (const i of s.items)
      if (i.status === "voided") {
        voidsCents += lineTotalCents(i);
        voidsCount++;
      }
  }
  return {
    range,
    sessions: sessions.length,
    grossCents: gross,
    discountsCents: discounts,
    avgTicketCents: sessions.length ? Math.round(gross / sessions.length) : 0,
    covers,
    perCoverCents: covers ? Math.round(gross / covers) : 0,
    byMethod,
    byDay: [...byDay.entries()].sort().map(([day, v]) => ({ day, grossCents: v.gross, count: v.count })),
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, grossCents: v.gross, count: v.count })),
    vat: [...vat.entries()].sort((a, b) => a[0] - b[0]).map(([ratePct, v]) => ({ ratePct, netCents: v.net, vatCents: v.vat, grossCents: v.gross })),
    voidsCents,
    voidsCount,
  };
}

export async function salesByProduct(range: DateRange) {
  const sessions = await closedSessions(range);
  const costs = await recipeCosts();
  const map = new Map<number, { productId: number; name: string; category: string; qty: number; grossCents: number; costCents: number }>();
  for (const s of sessions)
    for (const i of s.items) {
      if (i.status === "voided") continue;
      const e = map.get(i.productId) ?? {
        productId: i.productId,
        name: i.nameSnapshot,
        category: i.product.category.name,
        qty: 0,
        grossCents: 0,
        costCents: 0,
      };
      e.qty += i.qty;
      e.grossCents += lineTotalCents(i);
      e.costCents += (costs.get(i.productId) ?? 0) * i.qty;
      map.set(i.productId, e);
    }
  return [...map.values()]
    .map((e) => ({ ...e, marginCents: e.grossCents - e.costCents, marginPct: e.grossCents ? Math.round(((e.grossCents - e.costCents) / e.grossCents) * 100) : 0 }))
    .sort((a, b) => b.grossCents - a.grossCents);
}

export async function salesByCategory(range: DateRange) {
  const rows = await salesByProduct(range);
  const map = new Map<string, { category: string; qty: number; grossCents: number }>();
  for (const r of rows) {
    const e = map.get(r.category) ?? { category: r.category, qty: 0, grossCents: 0 };
    e.qty += r.qty;
    e.grossCents += r.grossCents;
    map.set(r.category, e);
  }
  return [...map.values()].sort((a, b) => b.grossCents - a.grossCents);
}

/** Πωλήσεις ανά σερβιτόρο (βάσει του ποιος έστειλε κάθε γύρο). */
export async function salesByEmployee(range: DateRange) {
  const sessions = await closedSessions(range);
  const map = new Map<number, { employeeId: number; name: string; grossCents: number; rounds: number; sessions: Set<number> }>();
  for (const s of sessions) {
    const orderEmp = new Map(s.orders.map((o) => [o.id, o.employee]));
    for (const o of s.orders) {
      const e = map.get(o.employeeId) ?? { employeeId: o.employeeId, name: o.employee.name, grossCents: 0, rounds: 0, sessions: new Set<number>() };
      e.rounds++;
      e.sessions.add(s.id);
      map.set(o.employeeId, e);
    }
    for (const i of s.items) {
      if (i.status === "voided") continue;
      const emp = orderEmp.get(i.orderId);
      if (!emp) continue;
      const e = map.get(emp.id)!;
      e.grossCents += lineTotalCents(i);
    }
  }
  return [...map.values()].map((e) => ({ ...e, sessions: e.sessions.size })).sort((a, b) => b.grossCents - a.grossCents);
}

/** Σύνοψη ζωντανής ημέρας για το dashboard: κλεισμένα + ανοιχτά. */
export async function todayDashboard() {
  const db = await getDb();
  const today = todayAthens();
  const summary = await salesSummary({ from: today, to: today });
  const open = await db.query.tableSessions.findMany({
    where: inArray(schema.tableSessions.status, ["open", "billed"]),
    with: { items: { with: { modifiers: true } }, payments: true },
  });
  const openCents = open.reduce((n, s) => n + computeTotals(s.items, s.discountCents, s.payments).totalCents, 0);
  const pendingKitchen = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orderItems)
    .where(inArray(schema.orderItems.status, ["sent", "preparing"]));
  return { today, summary, openSessions: open.length, openCents, pendingKitchen: pendingKitchen[0]?.n ?? 0 };
}

export async function listAudit(limit = 100) {
  const db = await getDb();
  return db.query.auditLog.findMany({ orderBy: [sql`${schema.auditLog.id} desc`], limit });
}
