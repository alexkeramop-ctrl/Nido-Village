/**
 * Λογαριασμός, εκπτώσεις, πληρωμές, κλείσιμο συνεδρίας.
 * Οι βάρδιες ανά ταμείο είναι στο ./registers.ts· η γρήγορη πώληση του ταμείου στο ./till.ts.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type DbLike } from "@/server/audit";
import type { PaymentMethod } from "@/db/schema";
import { emit } from "@/server/events";
import { vatIncludedCents } from "@/server/money";
import { getFiscalProvider } from "@/server/fiscal/provider";
import { enqueue, findReceiptStation } from "@/server/printing/queue";
import { billTicket, receiptTicket, type BillLine, type VatBreakdown } from "@/server/printing/templates";
import { getSettings } from "./settings";
import { logoImage } from "@/server/printing/logo";
import { releaseHeldOrdersTx } from "./held-orders";

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

export type PaymentInput = {
  method: PaymentMethod;
  amountCents: number;
  tenderedCents?: number | null;
  changeCents?: number;
  posTransactionId?: string | null;
};

/** Γράφει πληρωμές (και το ίχνος τους στο ιστορικό) μέσα σε υπάρχουσα συναλλαγή, χρεωμένες σε μια βάρδια ταμείου. */
export async function insertPaymentsTx(
  tx: DbLike,
  input: { sessionId: number; cashSessionId: number | null; payments: PaymentInput[]; employeeId: number; now?: Date },
) {
  if (!input.payments.length) return [];
  const now = input.now ?? new Date();
  const rows = await tx
    .insert(schema.payments)
    .values(
      input.payments.map((p) => ({
        sessionId: input.sessionId,
        cashSessionId: input.cashSessionId,
        method: p.method,
        amountCents: p.amountCents,
        tenderedCents: p.tenderedCents ?? p.amountCents,
        changeCents: p.changeCents ?? 0,
        posTransactionId: p.posTransactionId ?? null,
        employeeId: input.employeeId,
        createdAt: now,
      })),
    )
    .returning();
  await tx.insert(schema.auditLog).values(
    input.payments.map((p) => ({
      employeeId: input.employeeId,
      action: "payment",
      entity: "table_session",
      entityId: input.sessionId,
      details: { method: p.method, amountCents: p.amountCents, cashSessionId: input.cashSessionId },
    })),
  );
  return rows.sort((a, b) => a.id - b.id);
}

/** Κλείνει (εξοφλεί) μια συνεδρία. Οι κρατημένες παραγγελίες QR της στέλνονται τώρα στην κουζίνα/μπαρ. */
export async function closeSessionTx(tx: DbLike, sessionId: number, employeeId: number, now: Date = new Date()) {
  await tx.update(schema.tableSessions).set({ status: "closed", closedAt: now, closedBy: employeeId }).where(eq(schema.tableSessions.id, sessionId));
  return releaseHeldOrdersTx(tx, sessionId, now);
}

/**
 * Η βάρδια στην οποία χρεώνεται μια πληρωμή.
 *  - Με ρητό id (ταμείο): πρέπει να είναι ανοιχτή· κλειδώνεται «for share» ώστε να μην κλείσει στη μέση.
 *  - Χωρίς id (παλιά ροή, tests): η μοναδική ανοιχτή βάρδια αν υπάρχει ακριβώς μία, αλλιώς καμία
 *    (με δύο ανοιχτά ταμεία δεν μαντεύουμε σε ποιο ανήκει η είσπραξη).
 */
export async function resolveCashSessionTx(tx: DbLike, cashSessionId: number | null | undefined): Promise<number | null> {
  if (cashSessionId === null) return null;
  if (cashSessionId !== undefined) {
    const [cs] = await tx
      .select({ id: schema.cashSessions.id })
      .from(schema.cashSessions)
      .where(and(eq(schema.cashSessions.id, cashSessionId), isNull(schema.cashSessions.closedAt)))
      .for("share");
    if (!cs) throw new Error("Η βάρδια του ταμείου έχει κλείσει");
    return cs.id;
  }
  const open = await tx.select({ id: schema.cashSessions.id }).from(schema.cashSessions).where(isNull(schema.cashSessions.closedAt)).limit(2);
  return open.length === 1 ? open[0].id : null;
}

export async function addPayment(
  sessionId: number,
  input: { method: "cash" | "card" | "other"; amountCents: number; tenderedCents?: number; posTransactionId?: string | null },
  employeeId: number,
  opts: { cashSessionId?: number | null } = {},
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

  const result = await db.transaction(async (tx) => {
    // Κλείδωμα της συνεδρίας: δύο ταμεία δεν μπορούν να εισπράξουν ταυτόχρονα το ίδιο υπόλοιπο.
    const [locked] = await tx.select({ status: schema.tableSessions.status }).from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)).for("update");
    if (!locked || locked.status === "closed" || locked.status === "cancelled") throw new Error("Η συνεδρία έχει ήδη κλείσει");
    const [{ paid }] = await tx
      .select({ paid: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int` })
      .from(schema.payments)
      .where(eq(schema.payments.sessionId, sessionId));
    const due = s.totals.totalCents - paid;
    if (amount > due) throw new Error("Το ποσό υπερβαίνει το υπόλοιπο");
    const cashSessionId = await resolveCashSessionTx(tx, opts.cashSessionId);
    const [payment] = await insertPaymentsTx(tx, {
      sessionId,
      cashSessionId,
      payments: [{ method: input.method, amountCents: amount, tenderedCents: tendered, changeCents: change, posTransactionId: input.posTransactionId ?? null }],
      employeeId,
    });
    const closed = due - amount <= 0;
    const released = closed ? await closeSessionTx(tx, sessionId, employeeId) : null;
    return { payment, closed, released: released?.orderIds.length ?? 0 };
  });

  if (result.closed) await issueReceiptForSession(sessionId, employeeId);
  if (result.released) {
    emit({ type: "print.changed" });
    emit({ type: "kds.changed" });
  }
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
  return { payment: result.payment, closed: result.closed, changeCents: change };
}

/** Καλεί τον πάροχο (ή τον Noop) για απόδειξη 11.1 και τυπώνει μόνο αν εκδόθηκε. */
export async function issueReceiptForSession(sessionId: number, employeeId: number) {
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
        venue: { vatNumber: settings.vatNumber, address: settings.address, phone: settings.phone, taxOffice: settings.taxOffice, email: settings.email },
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
