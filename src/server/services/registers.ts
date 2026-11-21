/**
 * Ταμεία (σημεία πώλησης) και βάρδιες ανά ταμείο.
 *  - Κάθε ταμείο έχει το πολύ ΜΙΑ ανοιχτή βάρδια (μοναδικός δείκτης στη βάση)· πολλά ταμεία ανοίγουν ταυτόχρονα.
 *  - Κάθε πληρωμή γράφεται στη βάρδια του ταμείου όπου εισπράχθηκε (payments.cash_session_id).
 *  - Στο τέλος της ημέρας κάθε ταμείο κλείνει χωριστά: αναμενόμενα μετρητά, μετρημένα, διαφορά.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type DbLike } from "@/server/audit";
import { emit } from "@/server/events";
import { qrOrderingEnabled } from "@/server/features";
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

/* ------------------------------ Μπαρ και χώροι QR της βάρδιας ------------------------------ */

/**
 * Τι διαλέγει το ταμείο στο άνοιγμα της βάρδιας (και μπορεί να αλλάξει όσο είναι ανοιχτή):
 *  - το μπαρ όπου βγαίνουν τα ροφήματα των πωλήσεών του και των παραγγελιών QR που δέχεται·
 *  - τους χώρους των οποίων τις παραγγελίες QR δέχεται. Κάθε χώρος ανήκει σε ΕΝΑ ανοιχτό ταμείο τη φορά:
 *    αν τον πάρει άλλο ταμείο, φεύγει από το προηγούμενο. Χώρος χωρίς ανοιχτό ταμείο = κλειστός για QR.
 */
export type ShiftSetup = { barStationId: number | null; qrAreaIds: number[] };
export type QrAreaOwner = { shiftId: number; registerId: number | null; registerName: string; barStationId: number | null };
export type ShiftSetupOptions = {
  bars: { id: number; name: string }[];
  areas: { id: number; name: string; takenBy: string | null }[];
  /** Ό,τι ισχύει τώρα (ανοιχτή βάρδια) ή προτείνεται για το άνοιγμα (από την προηγούμενη βάρδια του ταμείου). */
  current: ShiftSetup;
};

/** Κλειδί για pg_advisory_xact_lock: ανάθεση χώρων QR σε ταμεία, ένα τη φορά. */
const QR_AREAS_LOCK = 20261121;

async function activeBars(db: DbLike) {
  return db
    .select({ id: schema.printStations.id, name: schema.printStations.name })
    .from(schema.printStations)
    .where(and(eq(schema.printStations.kind, "bar"), eq(schema.printStations.enabled, true)))
    .orderBy(asc(schema.printStations.sort), asc(schema.printStations.id));
}

async function activeAreas(db: DbLike) {
  return db
    .select({ id: schema.areas.id, name: schema.areas.name })
    .from(schema.areas)
    .where(eq(schema.areas.active, true))
    .orderBy(asc(schema.areas.sort), asc(schema.areas.id));
}

/** Ποιο ανοιχτό ταμείο δέχεται τις παραγγελίες QR κάθε χώρου (αν δύο το δηλώνουν ταυτόχρονα, κερδίζει η νεότερη βάρδια). */
export async function qrAreaOwners(db: DbLike): Promise<Map<number, QrAreaOwner>> {
  const open = await db.query.cashSessions.findMany({
    where: isNull(schema.cashSessions.closedAt),
    with: { register: true },
    orderBy: [asc(schema.cashSessions.id)],
  });
  const owners = new Map<number, QrAreaOwner>();
  for (const s of open) {
    for (const areaId of s.qrAreaIds ?? []) {
      owners.set(areaId, { shiftId: s.id, registerId: s.registerId, registerName: s.register?.name ?? LEGACY_REGISTER_NAME, barStationId: s.barStationId });
    }
  }
  return owners;
}

/** Ελέγχει τις επιλογές: μπαρ ενεργό (υποχρεωτικό όταν υπάρχει μπαρ), χώροι ενεργοί, χωρίς διπλά. */
async function cleanSetup(db: DbLike, setup: ShiftSetup): Promise<ShiftSetup> {
  const [bars, areas] = await Promise.all([activeBars(db), activeAreas(db)]);
  const bar = setup.barStationId === null || setup.barStationId === undefined ? null : Number(setup.barStationId);
  if (bar !== null && !bars.some((b) => b.id === bar)) throw new Error("Το μπαρ δεν βρέθηκε ή είναι απενεργοποιημένο");
  if (bar === null && bars.length) throw new Error("Διάλεξε σε ποιο μπαρ θα βγαίνουν τα ροφήματα");
  // Με κλειστό το QR κανένα ταμείο δεν δέχεται χώρους, ό,τι κι αν σταλεί.
  const ids = qrOrderingEnabled() ? [...new Set((Array.isArray(setup.qrAreaIds) ? setup.qrAreaIds : []).map(Number))] : [];
  if (ids.some((id) => !areas.some((a) => a.id === id))) throw new Error("Ο χώρος δεν βρέθηκε ή είναι απενεργοποιημένος");
  return { barStationId: bar, qrAreaIds: ids.sort((a, b) => a - b) };
}

/** Οι χώροι που παίρνει αυτή η βάρδια φεύγουν από τα άλλα ανοιχτά ταμεία. Επιστρέφει ποιο ταμείο έχασε ποιους χώρους. */
async function takeOverAreasTx(tx: DbLike, shiftId: number, areaIds: number[]): Promise<{ registerName: string; areaIds: number[] }[]> {
  if (!areaIds.length) return [];
  const others = await tx.query.cashSessions.findMany({
    where: and(isNull(schema.cashSessions.closedAt), ne(schema.cashSessions.id, shiftId)),
    with: { register: true },
  });
  const moved: { registerName: string; areaIds: number[] }[] = [];
  for (const o of others) {
    const lost = (o.qrAreaIds ?? []).filter((a) => areaIds.includes(a));
    if (!lost.length) continue;
    await tx
      .update(schema.cashSessions)
      .set({ qrAreaIds: (o.qrAreaIds ?? []).filter((a) => !areaIds.includes(a)) })
      .where(eq(schema.cashSessions.id, o.id));
    moved.push({ registerName: o.register?.name ?? LEGACY_REGISTER_NAME, areaIds: lost });
  }
  return moved;
}

/**
 * Επιλογές για το άνοιγμα (ή την αλλαγή) της βάρδιας ενός ταμείου. Πρόταση: ό,τι είχε η προηγούμενη βάρδια του,
 * χωρίς τους χώρους που έχει ήδη άλλο ανοιχτό ταμείο (ώστε να μην τους «πάρει» κατά λάθος).
 */
export async function shiftSetupOptions(registerId: number): Promise<ShiftSetupOptions> {
  const db = await getDb();
  const [bars, areas, owners, open, last] = await Promise.all([
    activeBars(db),
    activeAreas(db),
    qrAreaOwners(db),
    db.query.cashSessions.findFirst({ where: and(eq(schema.cashSessions.registerId, registerId), isNull(schema.cashSessions.closedAt)) }),
    db.query.cashSessions.findFirst({
      where: and(eq(schema.cashSessions.registerId, registerId), isNotNull(schema.cashSessions.closedAt)),
      orderBy: [desc(schema.cashSessions.closedAt), desc(schema.cashSessions.id)],
    }),
  ]);
  const takenBy = (areaId: number) => {
    const o = owners.get(areaId);
    return o && o.registerId !== registerId ? o.registerName : null;
  };
  let current: ShiftSetup;
  if (open) current = { barStationId: open.barStationId, qrAreaIds: open.qrAreaIds ?? [] };
  else {
    const lastBar = last?.barStationId ?? null;
    current = {
      barStationId: lastBar !== null && bars.some((b) => b.id === lastBar) ? lastBar : bars.length === 1 ? bars[0].id : null,
      qrAreaIds: (last?.qrAreaIds ?? []).filter((id) => areas.some((a) => a.id === id) && !takenBy(id)),
    };
  }
  // Με κλειστό το QR η οθόνη δεν δείχνει καθόλου επιλογή χώρων.
  if (!qrOrderingEnabled()) return { bars, areas: [], current: { ...current, qrAreaIds: [] } };
  return { bars, areas: areas.map((a) => ({ ...a, takenBy: takenBy(a.id) })), current };
}

/** Αλλαγή μπαρ / χώρων QR σε ανοιχτή βάρδια (π.χ. το άλλο ταμείο κλείνει και αυτό αναλαμβάνει και την Παιδική χαρά). */
export async function updateShiftSetup(cashSessionId: number, setup: ShiftSetup, employeeId: number) {
  const db = await getDb();
  const clean = await cleanSetup(db, setup);
  const moved = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${QR_AREAS_LOCK})`);
    const [cs] = await tx.select().from(schema.cashSessions).where(eq(schema.cashSessions.id, cashSessionId)).for("update");
    if (!cs) throw new Error("Η βάρδια δεν βρέθηκε");
    if (cs.closedAt) throw new Error("Η βάρδια έχει κλείσει");
    await tx.update(schema.cashSessions).set(clean).where(eq(schema.cashSessions.id, cashSessionId));
    const moved = await takeOverAreasTx(tx, cashSessionId, clean.qrAreaIds);
    await audit(tx, employeeId, "shift_setup", "cash_session", cashSessionId, { registerId: cs.registerId, ...clean, moved });
    return moved;
  });
  // Τα άλλα ταμεία ξαναρωτούν: αλλάζει ποιες παραγγελίες QR βλέπουν.
  emit({ type: "kds.changed" });
  return moved;
}

export async function getOpenShift(registerId: number) {
  const db = await getDb();
  return (await db.query.cashSessions.findFirst({ where: and(eq(schema.cashSessions.registerId, registerId), isNull(schema.cashSessions.closedAt)) })) ?? null;
}

/**
 * Άνοιγμα βάρδιας σε ένα ταμείο με αρχικό ταμείο (ρέστα), μπαρ και χώρους QR.
 * Χωρίς setup (παλιοί κλήτες/tests): χωρίς μπαρ (ισχύει το μπαρ της κατηγορίας) και χωρίς χώρους QR.
 */
export async function openRegisterShift(registerId: number, openingFloatCents: number, employeeId: number, setup?: ShiftSetup) {
  const db = await getDb();
  const float = Math.round(Number(openingFloatCents));
  if (!Number.isFinite(float) || float < 0) throw new Error("Μη έγκυρο αρχικό ταμείο");
  const register = await db.query.registers.findFirst({ where: eq(schema.registers.id, registerId) });
  if (!register) throw new Error("Το ταμείο δεν βρέθηκε");
  if (!register.active) throw new Error(`Το «${register.name}» είναι απενεργοποιημένο`);
  const clean: ShiftSetup = setup ? await cleanSetup(db, setup) : { barStationId: null, qrAreaIds: [] };
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${QR_AREAS_LOCK})`);
      const [row] = await tx
        .insert(schema.cashSessions)
        .values({ registerId, openedBy: employeeId, openingFloatCents: float, barStationId: clean.barStationId, qrAreaIds: clean.qrAreaIds })
        .returning();
      const moved = await takeOverAreasTx(tx, row.id, clean.qrAreaIds);
      await audit(tx, employeeId, "cash_open", "cash_session", row.id, { registerId, register: register.name, openingFloatCents: float, ...clean, moved });
      return row;
    });
    if (clean.qrAreaIds.length) emit({ type: "kds.changed" });
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
  /** Το μπαρ της βάρδιας (ροφήματα) και οι χώροι QR που δέχεται. */
  barStationId: number | null;
  barName: string | null;
  qrAreas: { id: number; name: string }[];
};

export const LEGACY_REGISTER_NAME = "Παλιό ταμείο";

const emptyTotals = (): MethodTotals => ({ cash: { totalCents: 0, count: 0 }, card: { totalCents: 0, count: 0 }, other: { totalCents: 0, count: 0 } });

/** Συνόψεις πολλών βαρδιών με 3 ερωτήματα (βάρδιες, σύνολα ανά τρόπο, πλήθος πωλήσεων). */
export async function shiftSummaries(db: DbLike, ids: number[]): Promise<ShiftSummary[]> {
  if (!ids.length) return [];
  const shifts = await db.query.cashSessions.findMany({
    where: inArray(schema.cashSessions.id, ids),
    orderBy: [asc(schema.cashSessions.openedAt), asc(schema.cashSessions.id)],
    with: { register: true, openedByEmployee: true, closedByEmployee: true, barStation: true },
  });
  const areaNames = new Map((await db.select({ id: schema.areas.id, name: schema.areas.name }).from(schema.areas)).map((a) => [a.id, a.name]));
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
      barStationId: cs.barStationId,
      barName: cs.barStation?.name ?? null,
      qrAreas: (cs.qrAreaIds ?? []).filter((id) => areaNames.has(id)).map((id) => ({ id, name: areaNames.get(id)! })),
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
  // Οι χώροι QR αυτού του ταμείου μένουν χωρίς ταμείο: οι απλήρωτες παραγγελίες τους φαίνονται πλέον στα άλλα.
  emit({ type: "kds.changed" });
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

