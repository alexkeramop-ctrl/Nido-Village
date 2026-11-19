/**
 * Ταμείο self-service (χωρίς σερβιτόρους).
 *  - quickSale: παραγγελία + αποστολή σε κουζίνα/μπαρ + πληρωμή + κλείσιμο σε ΜΙΑ συναλλαγή της βάσης.
 *    Αν αποτύχει οτιδήποτε δεν μένει ούτε πληρωμένη-αλλά-άσταλτη ούτε σταλμένη-αλλά-απλήρωτη παραγγελία.
 *  - payOrderAtTill: πληρωμή παραγγελίας QR (ή παλιού ανοιχτού λογαριασμού) στο ταμείο, με βομβητή.
 *  - Κάθε πληρωμή χρεώνεται στη βάρδια του ταμείου όπου έγινε.
 */
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DbLike } from "@/server/audit";
import { isWorker, runAfterResponse } from "@/server/cf";
import { emit } from "@/server/events";
import { isUniqueViolation } from "@/server/util";
import { planTender, type TenderInput } from "@/lib/tender";
import type { EmployeeRole, PaymentMethod } from "@/db/schema";
import { enqueueMany } from "@/server/printing/queue";
import { buzzerSlip } from "@/server/printing/templates";
import { closeSessionTx, computeTotals, insertPaymentsTx, issueReceiptForSession, lineTotalCents } from "./billing";
import { TILL_TYPE_LABEL, loadRoundContext, recordOrderSlip, resolveLines, sendRoundTx, type CartLine } from "./ordering";
import { listReadyForPickup, statusOf } from "./public-order";
import { getOpenShift, shiftSummary, toShiftDto } from "./registers";
import { athensDayStart, todayAthens } from "./reports";

export type TillEmployee = { id: number; name: string; role: EmployeeRole };
export type SaleDiscount = { cents: number; reason: string };

export type QuickSaleInput = {
  /** Η ανοιχτή βάρδια του ταμείου όπου γίνεται η πώληση. */
  cashSessionId: number;
  /** Κλειδί της συσκευής για αυτή την πώληση: δεύτερη αποστολή με το ίδιο κλειδί επιστρέφει την πρώτη πώληση. */
  clientRef: string;
  buzzerNo?: number | null;
  customerName?: string | null;
  lines: CartLine[];
  notes?: string | null;
  discount?: SaleDiscount | null;
  tender: TenderInput;
};

export type SaleResult = {
  sessionId: number;
  /** Πώς λέγεται η παραγγελία σε κουζίνα/πελάτη: «Βομβητής 12», όνομα ή #αριθμός. */
  displayNo: string;
  buzzerNo: number | null;
  totalCents: number;
  changeCents: number;
  payments: { method: PaymentMethod; amountCents: number }[];
  /** true όταν το ίδιο clientRef είχε ήδη καταχωρηθεί (δεν έγινε δεύτερη πώληση). */
  duplicate: boolean;
};

export const CLIENT_REF_CONSTRAINT = "table_sessions_clientRef_unique";

export function canDiscount(role: EmployeeRole): boolean {
  return role === "manager" || role === "admin";
}

function normalizeBuzzer(v: number | null | undefined): number | null {
  if (v === null || v === undefined || (v as unknown) === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error("Ο βομβητής πρέπει να είναι αριθμός από 1 έως 999");
  return n;
}

function displayNoOf(s: { id: number; buzzerNo: number | null; pickupCode?: string | null; customerName: string | null; label?: string | null }): string {
  if (s.buzzerNo) return `Βομβητής ${s.buzzerNo}`;
  if (s.pickupCode) return `#${s.pickupCode}${s.customerName ? ` ${s.customerName}` : ""}`;
  return s.customerName || s.label || `#${s.id}`;
}

async function lockOpenShiftTx(tx: DbLike, cashSessionId: number) {
  const [shift] = await tx
    .select({ id: schema.cashSessions.id, registerId: schema.cashSessions.registerId })
    .from(schema.cashSessions)
    .where(and(eq(schema.cashSessions.id, cashSessionId), isNull(schema.cashSessions.closedAt)))
    .for("share");
  if (!shift) throw new Error("Η βάρδια του ταμείου έχει κλείσει. Άνοιξε βάρδια για να συνεχίσεις.");
  return shift;
}

/**
 * Ο βομβητής δίνεται σε νέα παραγγελία. Αν τον «κρατά» άλλη σημερινή παραγγελία που δεν έχει παραδοθεί:
 *  - έτοιμη: ο βομβητής γύρισε στο ταμείο, άρα παραδόθηκε· τη σημειώνουμε ως παραδομένη·
 *  - ακόμη ετοιμάζεται: σφάλμα (δύο πελάτες με τον ίδιο βομβητή).
 */
async function claimBuzzerTx(tx: DbLike, buzzerNo: number, exceptSessionId: number | null, now: Date) {
  const holders = await tx.query.tableSessions.findMany({
    where: and(
      eq(schema.tableSessions.buzzerNo, buzzerNo),
      gte(schema.tableSessions.openedAt, athensDayStart(todayAthens())),
      ne(schema.tableSessions.status, "cancelled"),
      isNull(schema.tableSessions.pickedUpAt),
      exceptSessionId ? ne(schema.tableSessions.id, exceptSessionId) : undefined,
    ),
    with: { items: { columns: { status: true } } },
  });
  for (const h of holders) {
    const live = h.items.filter((i) => i.status !== "voided");
    if (live.some((i) => i.status === "sent" || i.status === "preparing")) {
      throw new Error(`Ο βομβητής ${buzzerNo} είναι ακόμη σε χρήση (η παραγγελία του ετοιμάζεται). Δώσε άλλον.`);
    }
    await tx
      .update(schema.orderItems)
      .set({ status: "served", servedAt: now })
      .where(and(eq(schema.orderItems.sessionId, h.id), eq(schema.orderItems.status, "ready")));
    await tx.update(schema.tableSessions).set({ pickedUpAt: now }).where(eq(schema.tableSessions.id, h.id));
  }
}

async function saleByClientRef(db: DbLike, clientRef: string): Promise<SaleResult | null> {
  const s = await db.query.tableSessions.findFirst({ where: eq(schema.tableSessions.clientRef, clientRef), with: { payments: true } });
  if (!s) return null;
  return {
    sessionId: s.id,
    displayNo: displayNoOf(s),
    buzzerNo: s.buzzerNo,
    totalCents: s.payments.reduce((n, p) => n + p.amountCents, 0),
    changeCents: s.payments.reduce((n, p) => n + p.changeCents, 0),
    payments: s.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
    duplicate: true,
  };
}

/** Εργασίες μετά το commit (φορολογικά). Με defer τρέχουν μετά την απάντηση ώστε το ταμείο να μην περιμένει. */
function afterCommit(task: () => Promise<void>, defer: boolean): Promise<void> {
  const safe = () => task().catch((e) => console.error("[nido] μετά την πώληση:", e));
  if (!defer) return safe();
  if (isWorker) runAfterResponse(safe);
  else void safe();
  return Promise.resolve();
}

/**
 * Γρήγορη πώληση: μία επιβεβαίωση = συνεδρία + παραγγελία + δελτία κουζίνας/μπαρ + αποθήκη + πληρωμή(ές) + κλείσιμο.
 * Η συνεδρία γράφεται εξαρχής «κλειστή» (πληρωμένη)· η ετοιμασία παρακολουθείται από την κατάσταση των ειδών.
 */
export async function quickSale(input: QuickSaleInput, employee: TillEmployee, opts: { deferFiscal?: boolean } = {}): Promise<SaleResult> {
  const db = await getDb();
  const clientRef = String(input.clientRef ?? "").trim();
  if (clientRef.length < 8 || clientRef.length > 64) throw new Error("Μη έγκυρο αναγνωριστικό πώλησης");
  const buzzerNo = normalizeBuzzer(input.buzzerNo);
  const customerName = input.customerName?.trim().slice(0, 40) || null;
  const notes = input.notes?.trim().slice(0, 200) || null;
  const lines = (input.lines ?? []).filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Το καλάθι είναι άδειο");

  const round = await loadRoundContext(db, lines);
  const resolved = resolveLines(lines, round.products);
  const wanted = Math.max(0, Math.round(input.discount?.cents ?? 0));
  const reason = input.discount?.reason?.trim().slice(0, 120) ?? "";
  if (wanted > 0) {
    if (!canDiscount(employee.role)) throw new Error("Έκπτωση μπορεί να κάνει μόνο υπεύθυνος ή διαχειριστής");
    if (!reason) throw new Error("Απαιτείται αιτιολογία έκπτωσης");
  }
  // Ίδιος υπολογισμός με λογαριασμούς και αναφορές (ΦΠΑ ανά συντελεστή, αναλογική έκπτωση).
  const totals = computeTotals(
    resolved.map(({ line, product, mods }) => ({ qty: line.qty, unitPriceCents: product.priceCents, status: "sent", vatRatePct: product.vatRate.ratePct, modifiers: mods })),
    wanted,
    [],
  );
  const plan = planTender(totals.totalCents, input.tender);
  const now = new Date();

  let done: { sessionId: number; orderId: number; tableName: string; fiscalLines: Awaited<ReturnType<typeof sendRoundTx>>["fiscalLines"] } | { duplicate: SaleResult };
  try {
    done = await db.transaction(async (tx) => {
      const existing = await saleByClientRef(tx, clientRef);
      if (existing) return { duplicate: existing };
      const shift = await lockOpenShiftTx(tx, input.cashSessionId);
      if (buzzerNo) await claimBuzzerTx(tx, buzzerNo, null, now);
      const [session] = await tx
        .insert(schema.tableSessions)
        .values({
          tableId: null,
          orderType: "takeaway",
          source: "till",
          label: customerName,
          customerName,
          buzzerNo,
          clientRef,
          status: "closed",
          openedBy: employee.id,
          openedAt: now,
          closedBy: employee.id,
          closedAt: now,
          discountCents: totals.discountCents,
          discountReason: totals.discountCents ? reason : null,
          discountBy: totals.discountCents ? employee.id : null,
        })
        .returning({ id: schema.tableSessions.id });
      const tableName = customerName ?? `#${session.id}`;
      const r = await sendRoundTx(tx, {
        sessionId: session.id,
        roundNo: 1,
        tableName,
        orderType: "takeaway",
        label: customerName,
        areaBarStationId: null,
        buzzerNo,
        customerName,
        typeLabel: TILL_TYPE_LABEL,
        employee,
        resolved,
        notes,
        stations: round.stations,
        now,
      });
      await insertPaymentsTx(tx, { sessionId: session.id, cashSessionId: shift.id, payments: plan.payments, employeeId: employee.id, now });
      await tx.insert(schema.auditLog).values([
        {
          employeeId: employee.id,
          action: "quick_sale",
          entity: "table_session",
          entityId: session.id,
          details: { cashSessionId: shift.id, registerId: shift.registerId, totalCents: totals.totalCents, buzzerNo, items: resolved.length },
        },
        ...(totals.discountCents
          ? [{ employeeId: employee.id, action: "discount", entity: "table_session", entityId: session.id, details: { discountCents: totals.discountCents, reason } }]
          : []),
      ]);
      return { sessionId: session.id, orderId: r.order.id, tableName, fiscalLines: r.fiscalLines };
    });
  } catch (e) {
    // Δύο ταυτόχρονες αποστολές με το ίδιο κλειδί: η δεύτερη σκοντάφτει στον μοναδικό δείκτη και επιστρέφει την πρώτη.
    if (isUniqueViolation(e, CLIENT_REF_CONSTRAINT)) {
      const existing = await saleByClientRef(db, clientRef);
      if (existing) return existing;
    }
    throw e;
  }
  if ("duplicate" in done) return done.duplicate;

  const { sessionId, orderId, tableName, fiscalLines } = done;
  await afterCommit(async () => {
    await recordOrderSlip({ sessionId, orderId, tableName, employeeName: employee.name, lines: fiscalLines, issuedAt: now });
    await issueReceiptForSession(sessionId, employee.id);
  }, !!opts.deferFiscal);
  emit({ type: "print.changed" });
  emit({ type: "kds.changed" });
  emit({ type: "stock.changed" });
  emit({ type: "session.changed", sessionId });
  return {
    sessionId,
    displayNo: buzzerNo ? `Βομβητής ${buzzerNo}` : tableName,
    buzzerNo,
    totalCents: totals.totalCents,
    changeCents: plan.changeCents,
    payments: plan.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
    duplicate: false,
  };
}

export type PayOrderInput = {
  sessionId: number;
  cashSessionId: number;
  buzzerNo?: number | null;
  /** Αν δοθεί, αντικαθιστά την έκπτωση του λογαριασμού (μόνο υπεύθυνος/διαχειριστής). */
  discount?: SaleDiscount | null;
  /** Τα μέρη πρέπει να αθροίζουν ακριβώς στο υπόλοιπο του λογαριασμού. */
  tender: TenderInput;
};

/**
 * Πληρωμή ανοιχτής παραγγελίας στο ταμείο (παραγγελία QR ή παλιός λογαριασμός): εξοφλεί ΟΛΟ το υπόλοιπο,
 * δίνει βομβητή, χρεώνει τη βάρδια του ταμείου και κλείνει τον λογαριασμό. Η ετοιμασία συνεχίζεται κανονικά.
 */
export async function payOrderAtTill(input: PayOrderInput, employee: TillEmployee, opts: { deferFiscal?: boolean } = {}): Promise<SaleResult> {
  const db = await getDb();
  const buzzerNo = normalizeBuzzer(input.buzzerNo);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const shift = await lockOpenShiftTx(tx, input.cashSessionId);
    // Κλείδωμα του λογαριασμού: δύο ταμεία δεν εισπράττουν ταυτόχρονα την ίδια παραγγελία.
    const [locked] = await tx
      .select({ id: schema.tableSessions.id, status: schema.tableSessions.status })
      .from(schema.tableSessions)
      .where(eq(schema.tableSessions.id, input.sessionId))
      .for("update");
    if (!locked) throw new Error("Η παραγγελία δεν βρέθηκε");
    if (locked.status === "closed") throw new Error("Η παραγγελία έχει ήδη πληρωθεί");
    if (locked.status === "cancelled") throw new Error("Η παραγγελία έχει ακυρωθεί");
    const s = (await tx.query.tableSessions.findFirst({
      where: eq(schema.tableSessions.id, input.sessionId),
      with: { table: true, items: { with: { modifiers: true, printStation: true } }, payments: true },
    }))!;
    const live = s.items.filter((i) => i.status !== "voided");
    if (!live.length) throw new Error("Δεν υπάρχουν είδη προς πληρωμή");

    let discountCents = s.discountCents;
    let discountReason = s.discountReason;
    let discountChanged = false;
    if (input.discount) {
      const wanted = Math.max(0, Math.round(input.discount.cents ?? 0));
      const reason = input.discount.reason?.trim().slice(0, 120) ?? "";
      if (wanted !== s.discountCents) {
        if (!canDiscount(employee.role)) throw new Error("Έκπτωση μπορεί να κάνει μόνο υπεύθυνος ή διαχειριστής");
        if (wanted > 0 && !reason) throw new Error("Απαιτείται αιτιολογία έκπτωσης");
        discountCents = wanted;
        discountReason = wanted ? reason : null;
        discountChanged = true;
      }
    }
    const totals = computeTotals(s.items, discountCents, s.payments);
    if (totals.dueCents < 0) throw new Error("Οι πληρωμές υπερβαίνουν το σύνολο");
    const plan = planTender(totals.dueCents, input.tender);

    const newBuzzer = buzzerNo !== null && buzzerNo !== s.buzzerNo;
    if (newBuzzer) await claimBuzzerTx(tx, buzzerNo, s.id, now);
    if (newBuzzer || discountChanged) {
      await tx
        .update(schema.tableSessions)
        .set({
          ...(newBuzzer ? { buzzerNo } : {}),
          ...(discountChanged ? { discountCents: totals.discountCents, discountReason: totals.discountCents ? discountReason : null, discountBy: totals.discountCents ? employee.id : null } : {}),
        })
        .where(eq(schema.tableSessions.id, s.id));
    }
    await insertPaymentsTx(tx, { sessionId: s.id, cashSessionId: shift.id, payments: plan.payments, employeeId: employee.id, now });
    await closeSessionTx(tx, s.id, employee.id, now);
    if (discountChanged) {
      await tx.insert(schema.auditLog).values({ employeeId: employee.id, action: "discount", entity: "table_session", entityId: s.id, details: { discountCents: totals.discountCents, reason: discountReason } });
    }

    // Η κουζίνα/μπαρ έχει ήδη τυπωμένο δελτίο χωρίς βομβητή: μικρό δελτίο «ΒΟΜΒΗΤΗΣ 12 για #003» σε όσους σταθμούς ετοιμάζουν ακόμη.
    let slips = 0;
    const name = s.table ? s.table.name : s.label ?? `#${s.id}`;
    if (newBuzzer) {
      const stations = new Map<number, { id: number; name: string; columns: number }>();
      for (const i of live) {
        if ((i.status === "sent" || i.status === "preparing") && i.printStation?.enabled) stations.set(i.printStation.id, i.printStation);
      }
      const jobs = await enqueueMany(
        tx,
        [...stations.values()].map((station) => ({ station, kind: "kitchen_ticket" as const, doc: buzzerSlip({ stationName: station.name, buzzerNo, orderName: name, time: now }) })),
      );
      slips = jobs.length;
    }
    const finalBuzzer = newBuzzer ? buzzerNo : s.buzzerNo;
    return {
      slips,
      sale: {
        sessionId: s.id,
        displayNo: finalBuzzer ? `Βομβητής ${finalBuzzer}` : name,
        buzzerNo: finalBuzzer,
        totalCents: totals.dueCents,
        changeCents: plan.changeCents,
        payments: plan.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
        duplicate: false,
      } satisfies SaleResult,
    };
  });

  await afterCommit(() => issueReceiptForSession(input.sessionId, employee.id), !!opts.deferFiscal);
  if (result.slips) emit({ type: "print.changed" });
  emit({ type: "session.changed", sessionId: input.sessionId });
  emit({ type: "floor.changed" });
  emit({ type: "kds.changed" });
  return result.sale;
}

/* ------------------------------ Λίστες ταμείου ------------------------------ */

export type PendingOrder = {
  sessionId: number;
  /** true: παραγγελία πελάτη από QR (πρώτες στη λίστα). */
  qr: boolean;
  name: string;
  code: string | null;
  customerName: string | null;
  openedAt: string;
  ready: boolean;
  /** Έχει ήδη μερική πληρωμή (παλιά ροή). */
  partial: boolean;
  itemCount: number;
  lines: { qty: number; name: string; modifiers: string[]; notes: string | null; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  dueCents: number;
};

/** «Προς πληρωμή»: ό,τι περιμένει είσπραξη στο ταμείο. Πρώτα οι παραγγελίες QR, μετά τυχόν παλιοί ανοιχτοί λογαριασμοί. */
export async function listPendingForTill(): Promise<PendingOrder[]> {
  const db = await getDb();
  const rows = await db.query.tableSessions.findMany({
    where: inArray(schema.tableSessions.status, ["open", "billed"]),
    orderBy: [asc(schema.tableSessions.openedAt)],
    with: { table: true, items: { orderBy: [asc(schema.orderItems.id)], with: { modifiers: true } }, payments: true },
  });
  const out = rows.map((s): PendingOrder => {
    const totals = computeTotals(s.items, s.discountCents, s.payments);
    const live = s.items.filter((i) => i.status !== "voided");
    const status = statusOf(s);
    return {
      sessionId: s.id,
      qr: s.source === "qr",
      name: s.table ? s.table.name : s.label ?? `#${s.id}`,
      code: s.pickupCode,
      customerName: s.customerName,
      openedAt: s.openedAt.toISOString(),
      ready: status === "ready" || status === "picked_up",
      partial: s.payments.length > 0,
      itemCount: live.reduce((n, i) => n + i.qty, 0),
      lines: live.map((i) => ({ qty: i.qty, name: i.nameSnapshot, modifiers: i.modifiers.map((m) => m.nameSnapshot), notes: i.notes, lineTotalCents: lineTotalCents(i) })),
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      totalCents: totals.totalCents,
      paidCents: totals.paidCents,
      dueCents: totals.dueCents,
    };
  });
  return out.filter((o) => o.itemCount > 0 && o.dueCents > 0).sort((a, b) => Number(b.qr) - Number(a.qr) || a.openedAt.localeCompare(b.openedAt));
}

/** Τα πιο πουλημένα είδη των τελευταίων ημερών (για την καρτέλα «Συχνά»). Επιστρέφει id ειδών, πρώτο το πιο συχνό. */
export async function topProducts(limit = 12, days = 30): Promise<number[]> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86400000);
  const total = sql<number>`sum(${schema.orderItems.qty})::int`;
  const rows = await db
    .select({ productId: schema.orderItems.productId, qty: total })
    .from(schema.orderItems)
    .where(and(ne(schema.orderItems.status, "voided"), gte(schema.orderItems.sentAt, since)))
    .groupBy(schema.orderItems.productId)
    .orderBy(desc(total), asc(schema.orderItems.productId))
    .limit(limit);
  return rows.map((r) => r.productId);
}

/** Ό,τι ανανεώνει το ταμείο στο παρασκήνιο, χωρίς να ξαναφορτώνει τη σελίδα (και τον κατάλογο). */
export async function tillSnapshot(registerId: number) {
  const db = await getDb();
  const [pending, ready, shift, off] = await Promise.all([
    listPendingForTill(),
    listReadyForPickup(),
    getOpenShift(registerId),
    db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.active, true), eq(schema.products.available, false))),
  ]);
  return { pending, ready, shift: shift ? toShiftDto(await shiftSummary(shift.id)) : null, unavailableIds: off.map((p) => p.id) };
}

export type TillSnapshot = Awaited<ReturnType<typeof tillSnapshot>>;
