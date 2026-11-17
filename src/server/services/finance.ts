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
import type { FinanceEntryRow, FinanceMonth, FinanceYear, UnpaidSummary } from "@/components/admin/finance/meta";
import { EXPENSE_CATEGORIES, FINANCE_METHOD_LABEL, INCOME_CATEGORIES } from "@/components/admin/finance/meta";
import { cleanAfm, validAfm, validIsoDate } from "@/lib/invoices";
import { addDays, athensDayStart, todayAthens } from "./reports";

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

type ManualRow = Awaited<ReturnType<typeof manualRows>>[number];

function toRow(e: ManualRow): FinanceEntryRow {
  return {
    id: e.id,
    kind: e.kind,
    date: e.date,
    category: e.category,
    description: e.description,
    amountCents: e.amountCents,
    vatCents: e.vatCents,
    netCents: e.netCents,
    method: e.method,
    docNumber: e.docNumber,
    supplierId: e.supplierId,
    supplierName: e.supplier?.name ?? null,
    supplierAfm: e.supplier?.vatNumber ?? null,
    eventTitle: e.event?.title ?? null,
    paid: e.paid,
    dueDate: e.dueDate,
    paidAt: e.paidAt,
    attachmentUrl: e.attachmentUrl,
    attachmentName: e.attachmentName,
    hasDriveFile: Boolean(e.attachmentFileId),
  };
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
  const entries: FinanceEntryRow[] = manual.map(toRow);
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

export type FinanceAttachment = { fileId: string; url: string; name: string };

export type FinanceInput = {
  id?: number;
  kind: FinanceKind;
  date: string;
  category: string;
  description?: string;
  /** Σύνολο με ΦΠΑ. */
  amountCents: number;
  vatCents?: number;
  /** Καθαρή αξία (τιμολόγια). */
  netCents?: number | null;
  method?: FinanceMethod;
  supplierId?: number | null;
  /** Νέος προμηθευτής από τη φόρμα τιμολογίου (δημιουργείται αν δεν υπάρχει ήδη με το ίδιο ΑΦΜ ή όνομα). */
  newSupplier?: { name: string; vatNumber?: string | null } | null;
  eventId?: number | null;
  docNumber?: string | null;
  /** false = οφείλεται. Χωρίς τιμή: πληρωμένο (όπως οι παλιές κινήσεις). */
  paid?: boolean;
  dueDate?: string | null;
  paidAt?: string | null;
  /** undefined = μην αλλάξεις το συνημμένο, null = αφαίρεσέ το από την κίνηση. */
  attachment?: FinanceAttachment | null;
};

const lower = (s: string) => s.trim().toLocaleLowerCase("el-GR");

/** Βρίσκει προμηθευτή με το ίδιο ΑΦΜ (ή το ίδιο όνομα) ή τον δημιουργεί. */
export async function findOrCreateSupplier(input: { name: string; vatNumber?: string | null }, employeeId: number) {
  const db = await getDb();
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Γράψε την επωνυμία του νέου προμηθευτή");
  const afmRaw = (input.vatNumber ?? "").trim();
  const afm = cleanAfm(afmRaw);
  if (afmRaw && !validAfm(afm)) throw new Error("Το ΑΦΜ του προμηθευτή δεν είναι έγκυρο (9 ψηφία). Για προμηθευτή εξωτερικού άφησέ το κενό.");
  const all = await db.query.suppliers.findMany();
  const existing = (afm ? all.find((s) => cleanAfm(s.vatNumber) === afm) : undefined) ?? all.find((s) => lower(s.name) === lower(name));
  if (existing) {
    const patch = { ...(afm && !existing.vatNumber ? { vatNumber: afm } : {}), ...(existing.active ? {} : { active: true }) };
    if (Object.keys(patch).length) await db.update(schema.suppliers).set(patch).where(eq(schema.suppliers.id, existing.id));
    return { id: existing.id, name: existing.name, created: false };
  }
  const [row] = await db.insert(schema.suppliers).values({ name, vatNumber: afm || null }).returning();
  await audit(db, employeeId, "supplier_create", "supplier", row.id, { name: row.name, from: "invoice" });
  return { id: row.id, name: row.name, created: true };
}

export async function upsertFinanceEntry(input: FinanceInput, employeeId: number) {
  const db = await getDb();
  if (input.kind !== "income" && input.kind !== "expense") throw new Error("Μη έγκυρος τύπος κίνησης");
  if (!validIsoDate(input.date)) throw new Error("Μη έγκυρη ημερομηνία");
  const cats: readonly string[] = input.kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!cats.includes(input.category)) throw new Error("Μη έγκυρη κατηγορία");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Το ποσό πρέπει να είναι θετικό");
  const vatCents = Math.max(0, Math.round(input.vatCents ?? 0));
  if (vatCents > input.amountCents) throw new Error("Ο ΦΠΑ δεν μπορεί να ξεπερνά το ποσό");
  const netCents = input.netCents === null || input.netCents === undefined ? null : Math.round(input.netCents);
  if (netCents !== null && (netCents < 0 || netCents > input.amountCents)) throw new Error("Η καθαρή αξία δεν μπορεί να ξεπερνά το σύνολο");
  const method = input.method ?? "bank";
  if (!(method in FINANCE_METHOD_LABEL)) throw new Error("Μη έγκυρος τρόπος πληρωμής");
  // Μόνο τα έξοδα μπορούν να οφείλονται· τα έσοδα περνιούνται όταν εισπραχθούν.
  const paid = input.kind === "income" ? true : input.paid !== false;
  for (const d of [input.dueDate, input.paidAt]) if (d && !validIsoDate(d)) throw new Error("Μη έγκυρη ημερομηνία πληρωμής");
  const a = input.attachment;
  if (a && (!a.fileId?.trim() || !/^https:\/\/(drive|docs)\.google\.com\//.test(a.url ?? "") || !a.name?.trim())) throw new Error("Μη έγκυρο συνημμένο");

  let supplierId = input.kind === "expense" ? (input.supplierId ?? null) : null;
  if (input.kind === "expense" && !supplierId && input.newSupplier?.name?.trim()) {
    supplierId = (await findOrCreateSupplier(input.newSupplier, employeeId)).id;
  }
  const values = {
    kind: input.kind,
    date: input.date,
    category: input.category,
    description: (input.description ?? "").trim().slice(0, 300),
    amountCents: input.amountCents,
    vatCents,
    netCents: input.kind === "expense" ? netCents : null,
    method,
    supplierId,
    // Η φόρμα δεν στέλνει εκδήλωση: σε επεξεργασία η υπάρχουσα σύνδεση με εκδήλωση μένει όπως είναι.
    ...(input.id && input.eventId === undefined ? {} : { eventId: input.eventId ?? null }),
    docNumber: input.docNumber?.trim().slice(0, 60) || null,
    paid,
    dueDate: paid ? null : (input.dueDate ?? null),
    paidAt: paid ? (input.paidAt ?? input.date) : null,
    ...(a === undefined
      ? {}
      : { attachmentUrl: a ? a.url : null, attachmentName: a ? a.name.slice(0, 200) : null, attachmentFileId: a ? a.fileId : null }),
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
    paid: row.paid,
    ...(row.attachmentName ? { attachment: row.attachmentName } : {}),
  });
  return row;
}

/** Όλα τα απλήρωτα τιμολόγια (όλων των μηνών), παλαιότερα πρώτα. */
export async function unpaidInvoices(today = todayAthens()): Promise<UnpaidSummary> {
  const db = await getDb();
  const rows = await db.query.financeEntries.findMany({
    where: and(eq(schema.financeEntries.kind, "expense"), eq(schema.financeEntries.paid, false)),
    with: { supplier: true, event: true },
    orderBy: [asc(schema.financeEntries.date), asc(schema.financeEntries.id)],
  });
  const overdue = rows.filter((r) => r.dueDate !== null && r.dueDate < today);
  return {
    totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
    count: rows.length,
    overdueCents: overdue.reduce((s, r) => s + r.amountCents, 0),
    overdueCount: overdue.length,
    entries: rows.map(toRow),
  };
}

/** «Σήμανση ως πληρωμένο»: ορίζει ημερομηνία και τρόπο πληρωμής. Η ημερομηνία παραστατικού (και το κέρδος του μήνα) δεν αλλάζει. */
export async function markFinanceEntryPaid(id: number, input: { method: FinanceMethod; paidAt?: string | null }, employeeId: number) {
  const db = await getDb();
  if (!(input.method in FINANCE_METHOD_LABEL)) throw new Error("Μη έγκυρος τρόπος πληρωμής");
  const paidAt = input.paidAt || todayAthens();
  if (!validIsoDate(paidAt)) throw new Error("Μη έγκυρη ημερομηνία πληρωμής");
  const e = await db.query.financeEntries.findFirst({ where: eq(schema.financeEntries.id, id) });
  if (!e) throw new Error("Η κίνηση δεν βρέθηκε");
  if (e.paid) throw new Error("Το τιμολόγιο είναι ήδη πληρωμένο");
  const [row] = await db.update(schema.financeEntries).set({ paid: true, paidAt, method: input.method }).where(eq(schema.financeEntries.id, id)).returning();
  await audit(db, employeeId, "finance_mark_paid", "finance_entry", id, { amountCents: e.amountCents, method: input.method, paidAt, date: e.date });
  return row;
}

export async function getFinanceEntry(id: number) {
  const db = await getDb();
  return (await db.query.financeEntries.findFirst({ where: eq(schema.financeEntries.id, id) })) ?? null;
}

export async function deleteFinanceEntry(id: number, employeeId: number) {
  const db = await getDb();
  const e = await db.query.financeEntries.findFirst({ where: eq(schema.financeEntries.id, id) });
  if (!e) throw new Error("Η κίνηση δεν βρέθηκε");
  await db.delete(schema.financeEntries).where(eq(schema.financeEntries.id, id));
  await audit(db, employeeId, "finance_delete", "finance_entry", id, { kind: e.kind, category: e.category, amountCents: e.amountCents, date: e.date });
}
