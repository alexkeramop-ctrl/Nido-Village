/**
 * Ταμεία (σημεία πώλησης) και βάρδιες ανά ταμείο.
 *  - Κάθε ταμείο έχει το πολύ ΜΙΑ ανοιχτή βάρδια (μοναδικός δείκτης στη βάση)· πολλά ταμεία ανοίγουν ταυτόχρονα.
 *  - Κάθε πληρωμή γράφεται στη βάρδια του ταμείου όπου εισπράχθηκε (payments.cash_session_id).
 *  - Στο τέλος της ημέρας κάθε ταμείο κλείνει χωριστά: αναμενόμενα μετρητά, μετρημένα, διαφορά.
 */
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type DbLike } from "@/server/audit";
import { isUniqueViolation } from "@/server/util";
import type { PaymentMethod } from "@/db/schema";
import { addDays, athensDayStart, todayAthens } from "./reports";

export const DEFAULT_REGISTER_NAMES = ["Ταμείο 1", "Ταμείο 2"];
const METHODS: PaymentMethod[] = ["cash", "card", "other"];

/**
 * Αυτο-ίαση: αν δεν υπάρχει κανένα ταμείο (π.χ. βάση παραγωγής πριν από τα πολλά ταμεία) δημιουργεί
 * «Ταμείο 1» και «Ταμείο 2», και περνά τυχόν παλιά ανοιχτή βάρδια (χωρίς ταμείο) στο πρώτο ελεύθερο.
 * Το καλούν και τα δύο seeds, ώστε να υπάρχει μία πηγή αλήθειας.
 */
export async function ensureDefaultRegisters(db: DbLike): Promise<void> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.registers);
  if (n === 0) {
    await db
      .insert(schema.registers)
      .values(DEFAULT_REGISTER_NAMES.map((name, i) => ({ name, sort: i + 1 })))
      .onConflictDoNothing({ target: schema.registers.name });
  }
  const legacy = await db
    .select({ id: schema.cashSessions.id })
    .from(schema.cashSessions)
    .where(and(isNull(schema.cashSessions.closedAt), isNull(schema.cashSessions.registerId)))
    .orderBy(asc(schema.cashSessions.id));
  if (!legacy.length) return;
  const free = await db
    .select({ id: schema.registers.id })
    .from(schema.registers)
    .leftJoin(schema.cashSessions, and(eq(schema.cashSessions.registerId, schema.registers.id), isNull(schema.cashSessions.closedAt)))
    .where(and(eq(schema.registers.active, true), isNull(schema.cashSessions.id)))
    .orderBy(asc(schema.registers.sort), asc(schema.registers.id));
  for (let i = 0; i < legacy.length && i < free.length; i++) {
    await db
      .update(schema.cashSessions)
      .set({ registerId: free[i].id })
      .where(and(eq(schema.cashSessions.id, legacy[i].id), isNull(schema.cashSessions.registerId), isNull(schema.cashSessions.closedAt)));
  }
}

export type RegisterRow = {
  id: number;
  name: string;
  sort: number;
  active: boolean;
  openShift: { id: number; openedAt: Date; openedBy: string; openingFloatCents: number } | null;
};

async function queryRegisters(db: DbLike): Promise<RegisterRow[]> {
  const rows = await db
    .select({
      id: schema.registers.id,
      name: schema.registers.name,
      sort: schema.registers.sort,
      active: schema.registers.active,
      shiftId: schema.cashSessions.id,
      openedAt: schema.cashSessions.openedAt,
      openingFloatCents: schema.cashSessions.openingFloatCents,
      openedBy: schema.employees.name,
    })
    .from(schema.registers)
    .leftJoin(schema.cashSessions, and(eq(schema.cashSessions.registerId, schema.registers.id), isNull(schema.cashSessions.closedAt)))
    .leftJoin(schema.employees, eq(schema.employees.id, schema.cashSessions.openedBy))
    .orderBy(asc(schema.registers.sort), asc(schema.registers.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sort: r.sort,
    active: r.active,
    openShift: r.shiftId && r.openedAt ? { id: r.shiftId, openedAt: r.openedAt, openedBy: r.openedBy ?? "", openingFloatCents: r.openingFloatCents ?? 0 } : null,
  }));
}

/** Τα ταμεία με την ανοιχτή τους βάρδια (αν έχουν). Δεν επιστρέφει ποτέ κενή λίστα σε άδεια βάση: δημιουργεί τα προεπιλεγμένα. */
export async function listRegisters(includeInactive = false): Promise<RegisterRow[]> {
  const db = await getDb();
  let rows = await queryRegisters(db);
  if (!rows.length) {
    await ensureDefaultRegisters(db);
    rows = await queryRegisters(db);
  }
  return includeInactive ? rows : rows.filter((r) => r.active);
}

export async function upsertRegister(input: { id?: number; name: string; sort?: number; active?: boolean }, employeeId: number) {
  const db = await getDb();
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Απαιτείται όνομα ταμείου");
  if (name.length > 30) throw new Error("Το όνομα του ταμείου είναι πολύ μεγάλο (έως 30 χαρακτήρες)");
  const active = input.active ?? true;
  const all = await queryRegisters(db);
  if (all.some((r) => r.id !== input.id && r.name.toLocaleLowerCase("el") === name.toLocaleLowerCase("el"))) throw new Error(`Υπάρχει ήδη ταμείο με όνομα «${name}»`);
  if (input.id) {
    const current = all.find((r) => r.id === input.id);
    if (!current) throw new Error("Το ταμείο δεν βρέθηκε");
    if (!active && current.active) {
      if (current.openShift) throw new Error("Κλείσε πρώτα τη βάρδια του ταμείου");
      if (!all.some((r) => r.id !== input.id && r.active)) throw new Error("Πρέπει να μείνει τουλάχιστον ένα ενεργό ταμείο");
    }
  }
  const values = { name, sort: Math.round(input.sort ?? (input.id ? all.find((r) => r.id === input.id)!.sort : all.length + 1)), active };
  try {
    const [row] = input.id
      ? await db.update(schema.registers).set(values).where(eq(schema.registers.id, input.id)).returning()
      : await db.insert(schema.registers).values(values).returning();
    await audit(db, employeeId, "register_save", "register", row.id, values);
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Υπάρχει ήδη ταμείο με όνομα «${name}»`);
    throw e;
  }
}

export async function getOpenShift(registerId: number) {
  const db = await getDb();
  return (await db.query.cashSessions.findFirst({ where: and(eq(schema.cashSessions.registerId, registerId), isNull(schema.cashSessions.closedAt)) })) ?? null;
}

/** Άνοιγμα βάρδιας σε ένα ταμείο με αρχικό ταμείο (ρέστα). */
export async function openRegisterShift(registerId: number, openingFloatCents: number, employeeId: number) {
  const db = await getDb();
  const float = Math.round(Number(openingFloatCents));
  if (!Number.isFinite(float) || float < 0) throw new Error("Μη έγκυρο αρχικό ταμείο");
  const register = await db.query.registers.findFirst({ where: eq(schema.registers.id, registerId) });
  if (!register) throw new Error("Το ταμείο δεν βρέθηκε");
  if (!register.active) throw new Error(`Το «${register.name}» είναι απενεργοποιημένο`);
  try {
    const [row] = await db.insert(schema.cashSessions).values({ registerId, openedBy: employeeId, openingFloatCents: float }).returning();
    await audit(db, employeeId, "cash_open", "cash_session", row.id, { registerId, register: register.name, openingFloatCents: float });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error("Το ταμείο έχει ήδη ανοιχτή βάρδια");
    throw e;
  }
}

/* ------------------------------ Σύνοψη βάρδιας ------------------------------ */

export type MethodTotals = Record<PaymentMethod, { totalCents: number; count: number }>;

export type ShiftSummary = {
  id: number;
  registerId: number | null;
  registerName: string;
  openedAt: Date;
  openedBy: string;
  closedAt: Date | null;
  closedBy: string | null;
  openingFloatCents: number;
  /** Πόσες πωλήσεις (λογαριασμοί) πληρώθηκαν σε αυτή τη βάρδια. */
  salesCount: number;
  byMethod: MethodTotals;
  totalCents: number;
  /** Αρχικό ταμείο + εισπράξεις μετρητών (τα ρέστα έχουν ήδη αφαιρεθεί από το ποσό κάθε πληρωμής). */
  expectedCashCents: number;
  countedCashCents: number | null;
  /** Μετρημένα − αναμενόμενα: θετικό = πλεόνασμα, αρνητικό = έλλειμμα. null όσο η βάρδια είναι ανοιχτή. */
  diffCents: number | null;
  notes: string | null;
};

export const LEGACY_REGISTER_NAME = "Παλιό ταμείο";

const emptyTotals = (): MethodTotals => ({ cash: { totalCents: 0, count: 0 }, card: { totalCents: 0, count: 0 }, other: { totalCents: 0, count: 0 } });

/** Συνόψεις πολλών βαρδιών με 3 ερωτήματα (βάρδιες, σύνολα ανά τρόπο, πλήθος πωλήσεων). */
export async function shiftSummaries(db: DbLike, ids: number[]): Promise<ShiftSummary[]> {
  if (!ids.length) return [];
  const shifts = await db.query.cashSessions.findMany({
    where: inArray(schema.cashSessions.id, ids),
    orderBy: [asc(schema.cashSessions.openedAt), asc(schema.cashSessions.id)],
    with: { register: true, openedByEmployee: true, closedByEmployee: true },
  });
  const totals = await db
    .select({
      cashSessionId: schema.payments.cashSessionId,
      method: schema.payments.method,
      total: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.payments)
    .where(inArray(schema.payments.cashSessionId, ids))
    .groupBy(schema.payments.cashSessionId, schema.payments.method);
  const sales = await db
    .select({ cashSessionId: schema.payments.cashSessionId, n: sql<number>`count(distinct ${schema.payments.sessionId})::int` })
    .from(schema.payments)
    .where(inArray(schema.payments.cashSessionId, ids))
    .groupBy(schema.payments.cashSessionId);
  const salesBy = new Map(sales.map((s) => [s.cashSessionId, s.n]));
  return shifts.map((cs) => {
    const byMethod = emptyTotals();
    for (const t of totals) if (t.cashSessionId === cs.id && METHODS.includes(t.method)) byMethod[t.method] = { totalCents: t.total, count: t.count };
    const expected = cs.openingFloatCents + byMethod.cash.totalCents;
    return {
      id: cs.id,
      registerId: cs.registerId,
      registerName: cs.register?.name ?? LEGACY_REGISTER_NAME,
      openedAt: cs.openedAt,
      openedBy: cs.openedByEmployee?.name ?? "",
      closedAt: cs.closedAt,
      closedBy: cs.closedByEmployee?.name ?? null,
      openingFloatCents: cs.openingFloatCents,
      salesCount: salesBy.get(cs.id) ?? 0,
      byMethod,
      totalCents: byMethod.cash.totalCents + byMethod.card.totalCents + byMethod.other.totalCents,
      expectedCashCents: expected,
      countedCashCents: cs.countedCashCents,
      diffCents: cs.closedAt && cs.countedCashCents !== null ? cs.countedCashCents - expected : null,
      notes: cs.notes,
    };
  });
}

/** Σειριοποιήσιμη μορφή (ημερομηνίες ως ISO) για τα client components και τα server actions. */
export type ShiftDto = Omit<ShiftSummary, "openedAt" | "closedAt"> & { openedAt: string; closedAt: string | null };

export function toShiftDto(s: ShiftSummary): ShiftDto {
  return { ...s, openedAt: s.openedAt.toISOString(), closedAt: s.closedAt ? s.closedAt.toISOString() : null };
}

export async function shiftSummary(cashSessionId: number): Promise<ShiftSummary> {
  const db = await getDb();
  const [s] = await shiftSummaries(db, [cashSessionId]);
  if (!s) throw new Error("Η βάρδια δεν βρέθηκε");
  return s;
}

/**
 * Κλείσιμο ταμείου: γράφει μετρημένα/αναμενόμενα μετρητά και σημειώσεις.
 * Δεν κλείνει όσο υπάρχει μισοτελειωμένη πώληση (λογαριασμός με μερική πληρωμή σε αυτή τη βάρδια).
 * Το «for update» στη γραμμή της βάρδιας αποκλείει πώληση που τρέχει ταυτόχρονα (εκείνη παίρνει «for share»).
 */
export async function closeRegisterShift(cashSessionId: number, countedCashCents: number, employeeId: number, notes?: string | null): Promise<ShiftSummary> {
  const db = await getDb();
  const counted = Math.round(Number(countedCashCents));
  if (!Number.isFinite(counted) || counted < 0) throw new Error("Δώσε το ποσό που μέτρησες");
  await db.transaction(async (tx) => {
    const [cs] = await tx.select().from(schema.cashSessions).where(eq(schema.cashSessions.id, cashSessionId)).for("update");
    if (!cs) throw new Error("Η βάρδια δεν βρέθηκε");
    if (cs.closedAt) throw new Error("Η βάρδια έχει ήδη κλείσει");
    const half = await tx
      .selectDistinct({ id: schema.tableSessions.id, label: schema.tableSessions.label, table: schema.tables.name })
      .from(schema.payments)
      .innerJoin(schema.tableSessions, eq(schema.payments.sessionId, schema.tableSessions.id))
      .leftJoin(schema.tables, eq(schema.tables.id, schema.tableSessions.tableId))
      .where(and(eq(schema.payments.cashSessionId, cashSessionId), inArray(schema.tableSessions.status, ["open", "billed"])));
    if (half.length) {
      const names = half.map((h) => h.table ?? h.label ?? `#${h.id}`).join(", ");
      throw new Error(`Υπάρχει μισοτελειωμένη πληρωμή (${names}). Ολοκλήρωσέ την πριν κλείσεις το ταμείο.`);
    }
    const [{ cash }] = await tx
      .select({ cash: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int` })
      .from(schema.payments)
      .where(and(eq(schema.payments.cashSessionId, cashSessionId), eq(schema.payments.method, "cash")));
    const expected = cs.openingFloatCents + cash;
    await tx
      .update(schema.cashSessions)
      .set({ closedAt: new Date(), closedBy: employeeId, countedCashCents: counted, expectedCashCents: expected, notes: notes?.trim().slice(0, 300) || null })
      .where(and(eq(schema.cashSessions.id, cashSessionId), isNull(schema.cashSessions.closedAt)));
    await audit(tx, employeeId, "cash_close", "cash_session", cashSessionId, {
      registerId: cs.registerId,
      countedCashCents: counted,
      expectedCashCents: expected,
      diff: counted - expected,
    });
  });
  return shiftSummary(cashSessionId);
}

/* ------------------------------ Σύνοψη ημέρας ------------------------------ */

export type DayTotals = {
  shifts: number;
  salesCount: number;
  cashCents: number;
  cardCents: number;
  otherCents: number;
  totalCents: number;
  openingFloatCents: number;
  expectedCashCents: number;
  /** Μόνο από κλειστές βάρδιες. */
  countedCashCents: number;
  diffCents: number;
  openShifts: number;
};

export type DaySummary = {
  date: string;
  registers: { registerId: number | null; name: string; active: boolean; shifts: (ShiftSummary & { carriedOver: boolean })[]; totals: DayTotals }[];
  /** Πληρωμές της ημέρας που δεν ανήκουν σε καμία βάρδια (π.χ. παλιά ροή χωρίς ανοιχτό ταμείο). */
  unassigned: { salesCount: number; cashCents: number; cardCents: number; otherCents: number; totalCents: number };
  total: DayTotals;
  /** Βάρδιες + «χωρίς ταμείο»: συμφωνεί με τα έσοδα ταμείου της ημέρας στα Έσοδα – Έξοδα. */
  grandTotalCents: number;
};

function sumTotals(shifts: ShiftSummary[]): DayTotals {
  const t: DayTotals = { shifts: shifts.length, salesCount: 0, cashCents: 0, cardCents: 0, otherCents: 0, totalCents: 0, openingFloatCents: 0, expectedCashCents: 0, countedCashCents: 0, diffCents: 0, openShifts: 0 };
  for (const s of shifts) {
    t.salesCount += s.salesCount;
    t.cashCents += s.byMethod.cash.totalCents;
    t.cardCents += s.byMethod.card.totalCents;
    t.otherCents += s.byMethod.other.totalCents;
    t.totalCents += s.totalCents;
    t.openingFloatCents += s.openingFloatCents;
    t.expectedCashCents += s.expectedCashCents;
    if (s.closedAt) {
      t.countedCashCents += s.countedCashCents ?? 0;
      t.diffCents += s.diffCents ?? 0;
    } else t.openShifts++;
  }
  return t;
}

/**
 * Όλες οι βάρδιες μιας ημέρας (ώρα Αθήνας) ανά ταμείο, με γενικό σύνολο.
 * Μια βάρδια ανήκει στην ημέρα που άνοιξε. Στη σημερινή ημέρα φαίνονται και όσες έμειναν ανοιχτές από πριν.
 */
export async function daySummary(isoDate: string): Promise<DaySummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error("Μη έγκυρη ημερομηνία");
  const db = await getDb();
  const start = athensDayStart(isoDate);
  const end = athensDayStart(addDays(isoDate, 1));
  const inDay = and(gte(schema.cashSessions.openedAt, start), lt(schema.cashSessions.openedAt, end));
  const where = isoDate === todayAthens() ? or(inDay, and(lt(schema.cashSessions.openedAt, start), isNull(schema.cashSessions.closedAt))) : inDay;
  const [idRows, registers, loose] = [
    await db.select({ id: schema.cashSessions.id }).from(schema.cashSessions).where(where),
    await queryRegisters(db),
    await db
      .select({
        method: schema.payments.method,
        total: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int`,
        sales: sql<number>`count(distinct ${schema.payments.sessionId})::int`,
      })
      .from(schema.payments)
      .where(and(isNull(schema.payments.cashSessionId), gte(schema.payments.createdAt, start), lt(schema.payments.createdAt, end)))
      .groupBy(schema.payments.method),
  ];
  const shifts = (await shiftSummaries(db, idRows.map((r) => r.id))).map((s) => ({ ...s, carriedOver: s.openedAt < start }));
  const groups: DaySummary["registers"] = registers
    .map((r) => {
      const mine = shifts.filter((s) => s.registerId === r.id);
      return { registerId: r.id as number | null, name: r.name, active: r.active, shifts: mine, totals: sumTotals(mine) };
    })
    .filter((g) => g.active || g.shifts.length > 0);
  const legacy = shifts.filter((s) => s.registerId === null);
  if (legacy.length) groups.push({ registerId: null, name: LEGACY_REGISTER_NAME, active: false, shifts: legacy, totals: sumTotals(legacy) });
  const unassigned = { salesCount: 0, cashCents: 0, cardCents: 0, otherCents: 0, totalCents: 0 };
  for (const l of loose) {
    if (l.method === "cash") unassigned.cashCents += l.total;
    else if (l.method === "card") unassigned.cardCents += l.total;
    else unassigned.otherCents += l.total;
    unassigned.totalCents += l.total;
    unassigned.salesCount += l.sales;
  }
  const total = sumTotals(shifts);
  return { date: isoDate, registers: groups, unassigned, total, grandTotalCents: total.totalCents + unassigned.totalCents };
}

