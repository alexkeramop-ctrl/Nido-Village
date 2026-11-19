/**
 * Έσοδα – έξοδα.
 *  - Έσοδα ταμείου: αυτόματα από τις πληρωμές (μετρητά/κάρτα/άλλο).
 *  - Αγορές αποθήκης: αυτόματα από τις παραλαβές (σύνολο παραστατικού).
 *  - Όλα τα υπόλοιπα (ενοίκιο, ρεύμα, μισθοί, προκαταβολές με μεταφορά…): χειροκίνητες κινήσεις.
 * Ποσά με ΦΠΑ, σε λεπτά. Ημερομηνίες σε ώρα Αθήνας.
 */
import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import type { FinanceKind, FinanceMethod } from "@/db/schema";
import type { FinanceEntryRow, FinanceMonth, FinanceYear } from "@/components/admin/finance/meta";
import { EXPENSE_CATEGORIES, FINANCE_METHOD_LABEL, INCOME_CATEGORIES } from "@/components/admin/finance/meta";
import { addDays, athensDayStart } from "./reports";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const athensDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });
const toAthens = (d: Date) => athensDate.format(d);

function monthBounds(month: string) {
  if (!MONTH_RE.test(month)) throw new Error("Μη έγκυρος μήνας");
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1), next };
}

/** Πληρωμές ταμείου και παραλαβές σε διάστημα [from, toExclusive). */
async function autoRows(from: string, toExclusive: string) {
  const db = await getDb();
  const start = athensDayStart(from);
  const end = athensDayStart(toExclusive);
  const [pays, receipts] = await Promise.all([
    db
      .select({ method: schema.payments.method, cents: schema.payments.amountCents, at: schema.payments.createdAt })
      .from(schema.payments)
      .where(and(gte(schema.payments.createdAt, start), lt(schema.payments.createdAt, end))),
    db.query.goodsReceipts.findMany({
      where: and(gte(schema.goodsReceipts.docDate, start), lt(schema.goodsReceipts.docDate, end)),
      with: { supplier: true },
      orderBy: [asc(schema.goodsReceipts.docDate)],
    }),
  ]);
  return { pays, receipts };
}

async function manualRows(from: string, toInclusive: string) {
  const db = await getDb();
  return db.query.financeEntries.findMany({
    where: and(gte(schema.financeEntries.date, from), lte(schema.financeEntries.date, toInclusive)),
    with: { supplier: true, event: true },
    orderBy: [asc(schema.financeEntries.date), asc(schema.financeEntries.id)],
  });
}

function sumBy(rows: { category: string; amountCents: number }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + r.amountCents);
  return [...m.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
}

export async function financeMonth(month: string): Promise<FinanceMonth> {
  const { from, to, next } = monthBounds(month);
  const [{ pays, receipts }, manual] = await Promise.all([autoRows(from, next), manualRows(from, to)]);

  const pos = { cash: 0, card: 0, other: 0 };
  const days = new Map<string, { income: number; expense: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { income: 0, expense: 0 });
  for (const p of pays) {
    pos[p.method] = (pos[p.method] ?? 0) + p.cents;
    const day = days.get(toAthens(p.at));
    if (day) day.income += p.cents;
  }
  let purchases = 0;
  for (const r of receipts) {
    purchases += r.totalCents;
    const day = days.get(toAthens(r.docDate));
    if (day) day.expense += r.totalCents;
  }
  const inc = manual.filter((e) => e.kind === "income");
  const exp = manual.filter((e) => e.kind === "expense");
  for (const e of manual) {
    const day = days.get(e.date);
    if (day) day[e.kind === "income" ? "income" : "expense"] += e.amountCents;
  }
  const posTotal = pos.cash + pos.card + pos.other;
  const manualIncome = inc.reduce((a, e) => a + e.amountCents, 0);
  const manualExpense = exp.reduce((a, e) => a + e.amountCents, 0);
  const incomeTotal = posTotal + manualIncome;
  const expenseTotal = purchases + manualExpense;
  const entries: FinanceEntryRow[] = manual.map((e) => ({
    id: e.id,
    kind: e.kind,
    date: e.date,
    category: e.category,
    description: e.description,
    amountCents: e.amountCents,
    vatCents: e.vatCents,
    method: e.method,
    docNumber: e.docNumber,
    supplierName: e.supplier?.name ?? null,
    eventTitle: e.event?.title ?? null,
  }));
  return {
    month,
    income: { pos, posTotal, manual: sumBy(inc), manualTotal: manualIncome, total: incomeTotal },
    expense: { purchases, manual: sumBy(exp), manualTotal: manualExpense, total: expenseTotal },
    net: incomeTotal - expenseTotal,
    days: [...days.entries()].map(([date, v]) => ({ date, ...v })),
    entries,
    receipts: receipts.map((r) => ({ id: r.id, date: toAthens(r.docDate), supplier: r.supplier?.name ?? null, docNumber: r.docNumber, cents: r.totalCents })),
  };
}

/** Έσοδα/έξοδα ανά μήνα για τους 12 μήνες που τελειώνουν στον δοσμένο. */
export async function financeYear(endMonth: string): Promise<FinanceYear> {
  const [y, m] = endMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const from = `${months[0]}-01`;
  const { to, next } = monthBounds(endMonth);
  const [{ pays, receipts }, manual] = await Promise.all([autoRows(from, next), manualRows(from, to)]);
  const acc = new Map(months.map((mm) => [mm, { income: 0, expense: 0 }]));
  for (const p of pays) {
    const a = acc.get(toAthens(p.at).slice(0, 7));
    if (a) a.income += p.cents;
  }
  for (const r of receipts) {
    const a = acc.get(toAthens(r.docDate).slice(0, 7));
    if (a) a.expense += r.totalCents;
  }
  for (const e of manual) {
    const a = acc.get(e.date.slice(0, 7));
    if (a) a[e.kind === "income" ? "income" : "expense"] += e.amountCents;
  }
  return months.map((month) => ({ month, ...acc.get(month)! }));
}

export type FinanceInput = {
  id?: number;
  kind: FinanceKind;
  date: string;
  category: string;
  description?: string;
  amountCents: number;
  vatCents?: number;
  method?: FinanceMethod;
  supplierId?: number | null;
  eventId?: number | null;
  docNumber?: string | null;
};

export async function upsertFinanceEntry(input: FinanceInput, employeeId: number) {
  const db = await getDb();
  if (input.kind !== "income" && input.kind !== "expense") throw new Error("Μη έγκυρος τύπος κίνησης");
  if (!DATE_RE.test(input.date)) throw new Error("Μη έγκυρη ημερομηνία");
  const cats: readonly string[] = input.kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!cats.includes(input.category)) throw new Error("Μη έγκυρη κατηγορία");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Το ποσό πρέπει να είναι θετικό");
  const vatCents = Math.max(0, Math.round(input.vatCents ?? 0));
  if (vatCents > input.amountCents) throw new Error("Ο ΦΠΑ δεν μπορεί να ξεπερνά το ποσό");
  const method = input.method ?? "bank";
  if (!(method in FINANCE_METHOD_LABEL)) throw new Error("Μη έγκυρος τρόπος πληρωμής");
  const values = {
    kind: input.kind,
    date: input.date,
    category: input.category,
    description: (input.description ?? "").trim().slice(0, 300),
    amountCents: input.amountCents,
    vatCents,
    method,
    supplierId: input.supplierId ?? null,
    eventId: input.eventId ?? null,
    docNumber: input.docNumber?.trim() || null,
  };
  const [row] = input.id
    ? await db.update(schema.financeEntries).set(values).where(eq(schema.financeEntries.id, input.id)).returning()
    : await db.insert(schema.financeEntries).values({ ...values, createdBy: employeeId }).returning();
  if (!row) throw new Error("Η κίνηση δεν βρέθηκε");
  await audit(db, employeeId, input.id ? "finance_update" : "finance_create", "finance_entry", row.id, {
    kind: row.kind,
    category: row.category,
    amountCents: row.amountCents,
    date: row.date,
  });
  return row;
}

export async function deleteFinanceEntry(id: number, employeeId: number) {
  const db = await getDb();
  const e = await db.query.financeEntries.findFirst({ where: eq(schema.financeEntries.id, id) });
  if (!e) throw new Error("Η κίνηση δεν βρέθηκε");
  await db.delete(schema.financeEntries).where(eq(schema.financeEntries.id, id));
  await audit(db, employeeId, "finance_delete", "finance_entry", id, { kind: e.kind, category: e.category, amountCents: e.amountCents, date: e.date });
}
