/**
 * Πληρωμές και οφειλές κρατήσεων.
 * Κάθε πληρωμή είναι μία κίνηση εσόδου στο «Έσοδα – Έξοδα» (finance_entries με eventId), ώστε να μετριέται
 * μία φορά στα οικονομικά. Εδώ δεν υπάρχει δεύτερος πίνακας: τα σύνολα υπολογίζονται από αυτές τις κινήσεις.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { emit } from "@/server/events";
import {
  PAYMENT_CATEGORY,
  PAYMENT_METHOD_LABEL,
  PAYMENT_TYPE_LABEL,
  daysBetween,
  paymentDescription,
  paymentNote,
  paymentTypeOfCategory,
  summarizePayments,
  type BookingPayment,
  type BookingPaymentMethod,
  type BookingPaymentType,
  type DueRow,
  type PaySummary,
} from "@/components/admin/bookings/meta";
import { formatEuro } from "@/server/money";
import { deleteFinanceEntry, upsertFinanceEntry } from "./finance";
import { todayAthens } from "./reports";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export type PaymentTotals = { depositCents: number; settlementCents: number };

/** Σύνολα εισπράξεων ανά κράτηση (προκαταβολές / εξοφλήσεις). Χωρίς ids: για όλες τις κρατήσεις. */
export async function paymentTotalsByEvent(eventIds?: number[]): Promise<Map<number, PaymentTotals>> {
  const out = new Map<number, PaymentTotals>();
  if (eventIds && !eventIds.length) return out;
  const db = await getDb();
  const fe = schema.financeEntries;
  const rows = await db
    .select({ eventId: fe.eventId, category: fe.category, cents: sql<number>`coalesce(sum(${fe.amountCents}), 0)::int` })
    .from(fe)
    .where(and(eq(fe.kind, "income"), eventIds ? inArray(fe.eventId, eventIds) : isNotNull(fe.eventId)))
    .groupBy(fe.eventId, fe.category);
  for (const r of rows) {
    if (r.eventId == null) continue;
    const t = out.get(r.eventId) ?? { depositCents: 0, settlementCents: 0 };
    if (paymentTypeOfCategory(r.category) === "deposit") t.depositCents += r.cents;
    else t.settlementCents += r.cents;
    out.set(r.eventId, t);
  }
  return out;
}

async function loadEvent(eventId: number) {
  const db = await getDb();
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) throw new Error("Η κράτηση δεν βρέθηκε");
  return event;
}

/** Τιμή, εισπράξεις, υπόλοιπο και οι πληρωμές μιας κράτησης. */
export async function eventPayments(eventId: number): Promise<{ eventId: number; title: string; date: string; status: string; summary: PaySummary; payments: BookingPayment[] }> {
  const db = await getDb();
  const event = await loadEvent(eventId);
  const rows = await db.query.financeEntries.findMany({
    where: and(eq(schema.financeEntries.eventId, eventId), eq(schema.financeEntries.kind, "income")),
    orderBy: [asc(schema.financeEntries.date), asc(schema.financeEntries.id)],
  });
  const totals: PaymentTotals = { depositCents: 0, settlementCents: 0 };
  const payments: BookingPayment[] = rows.map((r) => {
    const type = paymentTypeOfCategory(r.category);
    if (type === "deposit") totals.depositCents += r.amountCents;
    else totals.settlementCents += r.amountCents;
    return { id: r.id, date: r.date, amountCents: r.amountCents, method: r.method, type, note: paymentNote(r.description) };
  });
  return { eventId, title: event.title, date: event.date, status: event.status, summary: summarizePayments(event, totals), payments };
}

export type PaymentInput = {
  eventId: number;
  date: string;
  amountCents: number;
  method: BookingPaymentMethod;
  type: BookingPaymentType;
  note?: string | null;
};

/**
 * Καταχώρηση πληρωμής κράτησης: γράφεται ως έσοδο (προκαταβολή ή εξόφληση εκδήλωσης) δεμένο με την κράτηση.
 * Δεν επιτρέπεται ποσό μεγαλύτερο από το υπόλοιπο, εκτός αν η κράτηση δεν έχει τιμή (τότε επιστρέφεται προειδοποίηση).
 */
export async function recordEventPayment(input: PaymentInput, employeeId: number): Promise<{ paymentId: number; summary: PaySummary; warning: string | null }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Το ποσό πρέπει να είναι θετικό");
  if (!(input.type in PAYMENT_TYPE_LABEL)) throw new Error("Μη έγκυρος τύπος πληρωμής");
  if (!(input.method in PAYMENT_METHOD_LABEL)) throw new Error("Μη έγκυρος τρόπος πληρωμής");
  if (!isValidDate(input.date)) throw new Error("Μη έγκυρη ημερομηνία");
  if (input.date > todayAthens()) throw new Error("Η ημερομηνία πληρωμής δεν μπορεί να είναι μελλοντική");
  const event = await loadEvent(input.eventId);
  if (event.status === "cancelled") throw new Error("Η κράτηση είναι ακυρωμένη: δεν καταχωρούνται νέες πληρωμές");
  const before = (await eventPayments(event.id)).summary;
  if (before.priceCents > 0 && input.amountCents > before.balanceCents) {
    throw new Error(
      before.balanceCents > 0
        ? `Το ποσό ξεπερνά το υπόλοιπο της κράτησης (${formatEuro(before.balanceCents)})`
        : "Η κράτηση είναι ήδη εξοφλημένη",
    );
  }
  const entry = await upsertFinanceEntry(
    {
      kind: "income",
      date: input.date,
      category: PAYMENT_CATEGORY[input.type],
      description: paymentDescription(event, input.note),
      amountCents: input.amountCents,
      method: input.method,
      eventId: event.id,
    },
    employeeId,
  );
  const summary = (await eventPayments(event.id)).summary;
  // Δύο ταυτόχρονες καταχωρήσεις (π.χ. από δύο συσκευές) περνούν και οι δύο τον παραπάνω έλεγχο:
  // αν μαζί ξεπέρασαν την τιμή, αυτή εδώ αναιρείται ώστε να μη μείνει ποτέ είσπραξη πάνω από το υπόλοιπο.
  if (summary.priceCents > 0 && summary.paidCents > summary.priceCents) {
    await deleteFinanceEntry(entry.id, employeeId);
    throw new Error("Καταχωρήθηκε ταυτόχρονα άλλη πληρωμή για αυτή την κράτηση. Δες το νέο υπόλοιπο και δοκίμασε ξανά.");
  }
  const db = await getDb();
  await audit(db, employeeId, "event_payment", "event", event.id, { paymentId: entry.id, type: input.type, method: input.method, amountCents: input.amountCents, date: input.date });
  emit({ type: "catalog.changed" });
  const warning = before.priceCents > 0 ? null : "Η κράτηση δεν έχει τιμή: η πληρωμή καταχωρήθηκε, αλλά δεν υπολογίζεται υπόλοιπο. Όρισε τιμή στην κράτηση.";
  return { paymentId: entry.id, summary, warning };
}

/** Διαγραφή πληρωμής κράτησης (σβήνει την κίνηση εσόδου). Ο έλεγχος ρόλου γίνεται στο action (μόνο διαχειριστής). */
export async function deleteEventPayment(eventId: number, paymentId: number, employeeId: number): Promise<PaySummary> {
  const db = await getDb();
  const entry = await db.query.financeEntries.findFirst({ where: eq(schema.financeEntries.id, paymentId) });
  if (!entry || entry.eventId !== eventId || entry.kind !== "income") throw new Error("Η πληρωμή δεν βρέθηκε σε αυτή την κράτηση");
  await deleteFinanceEntry(paymentId, employeeId);
  await audit(db, employeeId, "event_payment_delete", "event", eventId, { paymentId, amountCents: entry.amountCents, date: entry.date, category: entry.category });
  emit({ type: "catalog.changed" });
  return (await eventPayments(eventId)).summary;
}

/** Όλες οι μη ακυρωμένες κρατήσεις με υπόλοιπο, κατά ημερομηνία (και όσες έχουν ήδη γίνει). */
export async function listBookingsDue(): Promise<{ rows: DueRow[]; totalCents: number; overdueCents: number; overdueCount: number }> {
  const db = await getDb();
  const today = todayAthens();
  const [events, totals] = await Promise.all([
    db.query.events.findMany({
      where: and(ne(schema.events.status, "cancelled"), gt(schema.events.priceCents, 0)),
      orderBy: [asc(schema.events.date), asc(schema.events.startTime), asc(schema.events.id)],
    }),
    paymentTotalsByEvent(),
  ]);
  const rows: DueRow[] = [];
  for (const e of events) {
    const pay = summarizePayments(e, totals.get(e.id));
    if (pay.balanceCents <= 0) continue;
    rows.push({
      id: e.id,
      title: e.title,
      type: e.type,
      status: e.status,
      date: e.date,
      startTime: e.startTime,
      customerName: e.customerName,
      customerPhone: e.customerPhone,
      depositCents: e.depositCents,
      pay,
      daysUntil: daysBetween(today, e.date),
    });
  }
  const overdue = rows.filter((r) => r.daysUntil < 0);
  return {
    rows,
    totalCents: rows.reduce((a, r) => a + r.pay.balanceCents, 0),
    overdueCents: overdue.reduce((a, r) => a + r.pay.balanceCents, 0),
    overdueCount: overdue.length,
  };
}

/** Για το dashboard: συνολικό υπόλοιπο κρατήσεων και αιτήματα από το site που περιμένουν. */
export async function bookingsDueSummary(): Promise<{ totalCents: number; count: number; websiteRequests: number }> {
  const db = await getDb();
  const [due, req] = await Promise.all([
    listBookingsDue(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.events)
      .where(and(eq(schema.events.source, "website"), eq(schema.events.status, "inquiry"), gte(schema.events.date, todayAthens()))),
  ]);
  return { totalCents: due.totalCents, count: due.rows.length, websiteRequests: req[0]?.n ?? 0 };
}
