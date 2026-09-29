/**
 * Λογαριασμός, εκπτώσεις, πληρωμές, κλείσιμο συνεδρίας, ταμειακές βάρδιες.
 */
import { asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { emit } from "@/server/events";
import { vatIncludedCents } from "@/server/money";
import { getFiscalProvider } from "@/server/fiscal/provider";
import { enqueue, findReceiptStation } from "@/server/printing/queue";
import { billTicket, receiptTicket, type BillLine, type VatBreakdown } from "@/server/printing/templates";
import { getSettings } from "./settings";
import { logoImage } from "@/server/printing/logo";

type ItemWithMods = {
  qty: number;
  unitPriceCents: number;
  status: string;
  vatRatePct: string | number;
  modifiers: { priceDeltaCents: number }[];
};

export function lineTotalCents(i: ItemWithMods): number {
  const mods = i.modifiers.reduce((n, m) => n + m.priceDeltaCents, 0);
  return (i.unitPriceCents + mods) * i.qty;
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  vat: VatBreakdown;
};

/** Υπολογισμός συνόλων. Η έκπτωση κατανέμεται αναλογικά στις κατηγορίες ΦΠΑ. */
export function computeTotals(items: ItemWithMods[], discountCents: number, payments: { amountCents: number }[]): Totals {
  const live = items.filter((i) => i.status !== "voided");
  const subtotal = live.reduce((n, i) => n + lineTotalCents(i), 0);
  const discount = Math.min(Math.max(0, discountCents), subtotal);
  const total = subtotal - discount;
  const byRate = new Map<number, number>();
  for (const i of live) {
    const r = Number(i.vatRatePct);
    byRate.set(r, (byRate.get(r) ?? 0) + lineTotalCents(i));
  }
  const vat: VatBreakdown = [];
  let allocated = 0;
  const rates = [...byRate.entries()].sort((a, b) => a[0] - b[0]);
  rates.forEach(([rate, gross], idx) => {
    let share = subtotal > 0 ? Math.round((discount * gross) / subtotal) : 0;
    if (idx === rates.length - 1) share = discount - allocated;
    allocated += share;
    const g = gross - share;
    const v = vatIncludedCents(g, rate);
    vat.push({ ratePct: rate, grossCents: g, vatCents: v, netCents: g - v });
  });
  const paid = payments.reduce((n, p) => n + p.amountCents, 0);
  return { subtotalCents: subtotal, discountCents: discount, totalCents: total, paidCents: paid, dueCents: total - paid, vat };
}

export async function getSessionDetail(sessionId: number) {
  const db = await getDb();
  const s = await db.query.tableSessions.findFirst({
    where: eq(schema.tableSessions.id, sessionId),
    with: {
      table: { with: { area: true } },
      openedByEmployee: true,
      orders: { orderBy: [asc(schema.orders.roundNo)], with: { employee: true } },
      items: { orderBy: [asc(schema.orderItems.id)], with: { modifiers: true, printStation: true } },
      payments: { orderBy: [asc(schema.payments.id)], with: { employee: true } },
    },
  });
  if (!s) return null;
  const totals = computeTotals(s.items, s.discountCents, s.payments);
  return { ...s, totals, displayName: s.table ? s.table.name : s.label ?? `#${s.id}` };
}

export type SessionDetail = NonNullable<Awaited<ReturnType<typeof getSessionDetail>>>;

function billLines(items: SessionDetail["items"]): BillLine[] {
  return items
    .filter((i) => i.status !== "voided")
    .map((i) => ({ qty: i.qty, name: i.nameSnapshot, modifiers: i.modifiers.map((m) => m.nameSnapshot), lineTotalCents: lineTotalCents(i) }));
}

export async function applyDiscount(sessionId: number, discountCents: number, reason: string, employeeId: number) {
  const db = await getDb();
  const s = await getSessionDetail(sessionId);
  if (!s) throw new Error("Η συνεδρία δεν βρέθηκε");
  if (s.status === "closed" || s.status === "cancelled") throw new Error("Η συνεδρία έχει κλείσει");
  if (discountCents > 0 && !reason.trim()) throw new Error("Απαιτείται αιτιολογία έκπτωσης");
  const capped = Math.min(Math.max(0, Math.round(discountCents)), s.totals.subtotalCents);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.tableSessions)
      .set({ discountCents: capped, discountReason: capped ? reason.trim() : null, discountBy: capped ? employeeId : null })
      .where(eq(schema.tableSessions.id, sessionId));
    await audit(tx, employeeId, "discount", "table_session", sessionId, { discountCents: capped, reason });
  });
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
}

export async function printBill(sessionId: number, employeeId: number) {
  const db = await getDb();
  const s = await getSessionDetail(sessionId);
  if (!s) throw new Error("Η συνεδρία δεν βρέθηκε");
  if (s.status === "closed" || s.status === "cancelled") throw new Error("Η συνεδρία έχει κλείσει");
  const station = await findReceiptStation(db);
  if (!station) throw new Error("Δεν έχει οριστεί εκτυπωτής ταμείου (σταθμός τύπου «receipt»)");
  const settings = await getSettings();
  const doc = billTicket({
    venueName: settings.venueName,
    tableName: s.displayName,
    waiter: s.openedByEmployee.name,
    time: new Date(),
    covers: s.covers,
    lines: billLines(s.items),
    subtotalCents: s.totals.subtotalCents,
    discountCents: s.totals.discountCents,
    totalCents: s.totals.totalCents,
    vat: s.totals.vat,
    sessionId: s.id,
    logo: logoImage(),
  });
  await db.transaction(async (tx) => {
    await enqueue(tx, station.id, "bill", doc);
    await tx
      .update(schema.tableSessions)
      .set({ billPrintedAt: new Date(), status: s.status === "open" ? "billed" : s.status })
      .where(eq(schema.tableSessions.id, sessionId));
    await audit(tx, employeeId, "print_bill", "table_session", sessionId, { totalCents: s.totals.totalCents });
  });
  emit({ type: "print.changed" });
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
}

export async function addPayment(
  sessionId: number,
  input: { method: "cash" | "card" | "other"; amountCents: number; tenderedCents?: number; posTransactionId?: string | null },
  employeeId: number,
) {
  const db = await getDb();
  const s = await getSessionDetail(sessionId);
  if (!s) throw new Error("Η συνεδρία δεν βρέθηκε");
  if (s.status === "closed" || s.status === "cancelled") throw new Error("Η συνεδρία έχει ήδη κλείσει");
  const amount = Math.round(input.amountCents);
  if (amount <= 0) throw new Error("Μη έγκυρο ποσό");
  if (amount > s.totals.dueCents) throw new Error("Το ποσό υπερβαίνει το υπόλοιπο");
  if (s.totals.totalCents === 0 && s.items.every((i) => i.status === "voided")) throw new Error("Δεν υπάρχουν είδη προς πληρωμή");
  const tendered = input.method === "cash" ? Math.round(input.tenderedCents ?? amount) : amount;
  if (tendered < amount) throw new Error("Τα μετρητά είναι λιγότερα από το ποσό");
  const change = tendered - amount;
  const cash = await getCurrentCashSession();

  const closedNow = s.totals.dueCents - amount <= 0;
  const result = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.payments)
      .values({
        sessionId,
        cashSessionId: cash?.id ?? null,
        method: input.method,
        amountCents: amount,
        tenderedCents: tendered,
        changeCents: change,
        posTransactionId: input.posTransactionId ?? null,
        employeeId,
      })
      .returning();
    await audit(tx, employeeId, "payment", "table_session", sessionId, { method: input.method, amountCents: amount });
    if (closedNow) {
      await tx
        .update(schema.tableSessions)
        .set({ status: "closed", closedAt: new Date(), closedBy: employeeId })
        .where(eq(schema.tableSessions.id, sessionId));
    }
    return p;
  });

  if (closedNow) await issueReceiptForSession(sessionId, employeeId);
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
  return { payment: result, closed: closedNow, changeCents: change };
}

/** Καλεί τον πάροχο (ή τον Noop) για απόδειξη 11.1 και τυπώνει μόνο αν εκδόθηκε. */
async function issueReceiptForSession(sessionId: number, employeeId: number) {
  const db = await getDb();
  const s = await getSessionDetail(sessionId);
  if (!s) return;
  const provider = getFiscalProvider();
  const settings = await getSettings();
  const lines = s.items
    .filter((i) => i.status !== "voided")
    .map((i) => ({
      name: i.nameSnapshot,
      qty: i.qty,
      unitPriceCents: lineTotalCents({ ...i, qty: 1 }),
      vatRatePct: Number(i.vatRatePct),
      mydataVatCategory: null,
    }));
  const res = await provider.issueReceipt({
    sessionId,
    tableName: s.displayName,
    lines,
    discountCents: s.totals.discountCents,
    totalCents: s.totals.totalCents,
    payments: s.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, posTransactionId: p.posTransactionId })),
    issuedAt: new Date(),
  });
  await db.insert(schema.fiscalDocuments).values({
    sessionId,
    kind: "receipt_11_1",
    status: res.status,
    provider: res.provider,
    series: res.status === "issued" ? res.series ?? null : null,
    number: res.status === "issued" ? res.number ?? null : null,
    mark: res.status === "issued" ? res.mark ?? null : null,
    uid: res.status === "issued" ? res.uid ?? null : null,
    qrUrl: res.status === "issued" ? res.qrUrl ?? null : null,
    payload: res.status === "issued" ? (res.raw as object) ?? null : res.status === "not_required" ? { note: res.note } : null,
    error: res.status === "failed" ? res.error : null,
    issuedAt: res.status === "issued" ? new Date() : null,
  });
  if (res.status === "issued") {
    const station = await findReceiptStation(db);
    if (station) {
      const doc = receiptTicket({
        venueName: settings.venueName,
        venue: { vatNumber: settings.vatNumber, address: settings.address, phone: settings.phone, taxOffice: settings.taxOffice },
        tableName: s.displayName,
        waiter: s.openedByEmployee.name,
        time: new Date(),
        covers: s.covers,
        lines: billLines(s.items),
        subtotalCents: s.totals.subtotalCents,
        discountCents: s.totals.discountCents,
        totalCents: s.totals.totalCents,
        vat: s.totals.vat,
        sessionId,
        logo: logoImage(),
        fiscal: { series: res.series, number: res.number, mark: res.mark, uid: res.uid, qrUrl: res.qrUrl, providerName: res.provider },
        payments: s.payments.map((p) => ({ method: p.method, amountCents: p.amountCents, posTransactionId: p.posTransactionId })),
      });
      await enqueue(db, station.id, "receipt", doc);
      emit({ type: "print.changed" });
    }
  }
  void employeeId;
}

/** Συνεδρίες που περιμένουν πληρωμή, για την οθόνη ταμείου. */
export async function listSessionsForCashier() {
  const db = await getDb();
  const rows = await db.query.tableSessions.findMany({
    where: inArray(schema.tableSessions.status, ["open", "billed"]),
    orderBy: [asc(schema.tableSessions.openedAt)],
    with: { table: true, openedByEmployee: true, items: { with: { modifiers: true } }, payments: true },
  });
  return rows.map((s) => ({
    id: s.id,
    displayName: s.table ? s.table.name : s.label ?? `#${s.id}`,
    orderType: s.orderType,
    status: s.status,
    waiter: s.openedByEmployee.name,
    openedAt: s.openedAt,
    totals: computeTotals(s.items, s.discountCents, s.payments),
    itemCount: s.items.filter((i) => i.status !== "voided").reduce((n, i) => n + i.qty, 0),
    source: s.source,
    pickupCode: s.pickupCode,
    customerName: s.customerName,
    readyAt: s.readyAt,
    pickedUpAt: s.pickedUpAt,
  }));
}

export async function listRecentClosedSessions(limit = 30) {
  const db = await getDb();
  const rows = await db.query.tableSessions.findMany({
    where: eq(schema.tableSessions.status, "closed"),
    orderBy: [desc(schema.tableSessions.closedAt)],
    limit,
    with: { table: true, openedByEmployee: true, items: { with: { modifiers: true } }, payments: true },
  });
  return rows.map((s) => ({
    id: s.id,
    displayName: s.table ? s.table.name : s.label ?? `#${s.id}`,
    closedAt: s.closedAt,
    waiter: s.openedByEmployee.name,
    totals: computeTotals(s.items, s.discountCents, s.payments),
    methods: [...new Set(s.payments.map((p) => p.method))],
  }));
}

/* ---------------------------- Ταμειακές βάρδιες ---------------------------- */

export async function getCurrentCashSession() {
  const db = await getDb();
  return db.query.cashSessions.findFirst({ where: isNull(schema.cashSessions.closedAt), orderBy: [desc(schema.cashSessions.id)] });
}

export async function openCashSession(openingFloatCents: number, employeeId: number) {
  const db = await getDb();
  const existing = await getCurrentCashSession();
  if (existing) throw new Error("Υπάρχει ήδη ανοιχτή βάρδια ταμείου");
  const [row] = await db
    .insert(schema.cashSessions)
    .values({ openedBy: employeeId, openingFloatCents: Math.max(0, Math.round(openingFloatCents)) })
    .returning();
  await audit(db, employeeId, "cash_open", "cash_session", row.id, { openingFloatCents });
  return row;
}

export async function cashSessionSummary(cashSessionId: number) {
  const db = await getDb();
  const cs = await db.query.cashSessions.findFirst({ where: eq(schema.cashSessions.id, cashSessionId) });
  if (!cs) throw new Error("Η βάρδια δεν βρέθηκε");
  const rows = await db
    .select({
      method: schema.payments.method,
      total: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.payments)
    .where(eq(schema.payments.cashSessionId, cashSessionId))
    .groupBy(schema.payments.method);
  const byMethod = Object.fromEntries(rows.map((r) => [r.method, { totalCents: r.total, count: r.count }])) as Record<
    string,
    { totalCents: number; count: number }
  >;
  const cash = byMethod.cash?.totalCents ?? 0;
  return {
    cashSession: cs,
    byMethod,
    expectedCashCents: cs.openingFloatCents + cash,
    totalCents: rows.reduce((n, r) => n + r.total, 0),
  };
}

export async function closeCashSession(countedCashCents: number, employeeId: number, notes?: string) {
  const db = await getDb();
  const current = await getCurrentCashSession();
  if (!current) throw new Error("Δεν υπάρχει ανοιχτή βάρδια ταμείου");
  const summary = await cashSessionSummary(current.id);
  const [row] = await db
    .update(schema.cashSessions)
    .set({
      closedAt: new Date(),
      closedBy: employeeId,
      countedCashCents: Math.round(countedCashCents),
      expectedCashCents: summary.expectedCashCents,
      notes: notes ?? null,
    })
    .where(eq(schema.cashSessions.id, current.id))
    .returning();
  await audit(db, employeeId, "cash_close", "cash_session", row.id, {
    countedCashCents,
    expectedCashCents: summary.expectedCashCents,
    diff: countedCashCents - summary.expectedCashCents,
  });
  return { ...summary, cashSession: row };
}

export async function listCashSessions(limit = 20) {
  const db = await getDb();
  return db.query.cashSessions.findMany({ orderBy: [desc(schema.cashSessions.id)], limit });
}

