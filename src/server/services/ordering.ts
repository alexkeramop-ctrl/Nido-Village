/**
 * Παραγγελιοληψία: άνοιγμα τραπεζιού, αποστολή γύρου, ακυρώσεις, KDS.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type DbLike } from "@/server/audit";
import { emit } from "@/server/events";
import { getFiscalProvider, type FiscalLine } from "@/server/fiscal/provider";
import { enqueue, enqueueMany } from "@/server/printing/queue";
import { kitchenTicket, voidTicket, type KitchenItem } from "@/server/printing/templates";
import type { OrderType, SessionSource } from "@/db/schema";
import { applyRecipeMovements, applyRecipeMovementsBatch } from "./inventory";
import { findOpenSessionForTable } from "./floor";
import { getSessionDetail } from "./billing";

/** Ετικέτα στα δελτία κουζίνας/μπαρ και στο KDS για πώληση από ταμείο self-service. */
export const TILL_TYPE_LABEL = "ΤΑΜΕΙΟ";

export type CartLine = {
  productId: number;
  qty: number;
  course?: number;
  notes?: string | null;
  modifierIds?: number[];
};

export async function openSession(
  input: { tableId?: number | null; orderType?: OrderType; label?: string | null; covers?: number },
  employeeId: number,
) {
  const db = await getDb();
  if (input.tableId) {
    const existing = await findOpenSessionForTable(input.tableId);
    if (existing) return existing;
  }
  const orderType: OrderType = input.tableId ? "dine_in" : input.orderType ?? "takeaway";
  if (!input.tableId && !input.label?.trim()) throw new Error("Δώσε όνομα για το πακέτο/delivery");
  const [row] = await db
    .insert(schema.tableSessions)
    .values({
      tableId: input.tableId ?? null,
      orderType,
      label: input.label?.trim() || null,
      covers: input.covers ?? 0,
      openedBy: employeeId,
    })
    .returning();
  emit({ type: "floor.changed" });
  return row;
}

export async function setCovers(sessionId: number, covers: number) {
  const db = await getDb();
  await db.update(schema.tableSessions).set({ covers: Math.max(0, covers) }).where(eq(schema.tableSessions.id, sessionId));
  emit({ type: "session.changed", sessionId });
}

/* ------------------------- Αποστολή γύρου (πυρήνας) ------------------------- */

/** Ό,τι χρειάζεται ένας γύρος από τη βάση: τα είδη (με κατηγορία, ΦΠΑ, επιλογές) και οι ενεργοί σταθμοί. Δύο ερωτήματα παράλληλα. */
export async function loadRoundContext(db: DbLike, lines: CartLine[]) {
  const productIds = [...new Set(lines.map((l) => l.productId))].filter((id) => Number.isInteger(id));
  const [products, stations] = await Promise.all([
    productIds.length
      ? db.query.products.findMany({
          where: and(inArray(schema.products.id, productIds), eq(schema.products.active, true)),
          with: { category: true, vatRate: true, modifierGroups: { with: { group: { with: { modifiers: true } } } } },
        })
      : Promise.resolve([]),
    db.query.printStations.findMany({ where: eq(schema.printStations.enabled, true) }),
  ]);
  return { products, stations };
}

export type RoundContext = Awaited<ReturnType<typeof loadRoundContext>>;
type RoundProduct = RoundContext["products"][number];
type RoundModifier = { id: number; name: string; priceDeltaCents: number };
export type ResolvedLine = { line: CartLine; product: RoundProduct; mods: RoundModifier[] };

/** Ελέγχει το καλάθι απέναντι στον κατάλογο (διαθεσιμότητα, έγκυρες επιλογές) χωρίς να αγγίζει τη βάση. */
export function resolveLines(cart: CartLine[], products: RoundProduct[]): ResolvedLine[] {
  const lines = cart.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Η παραγγελία είναι κενή");
  const byId = new Map(products.map((p) => [p.id, p]));
  return lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new Error(`Το είδος ${line.productId} δεν είναι διαθέσιμο`);
    if (!product.available) throw new Error(`Το είδος «${product.name}» έχει εξαντληθεί`);
    const allowed = new Map<number, RoundModifier>();
    for (const pg of product.modifierGroups) for (const m of pg.group.modifiers) if (m.active) allowed.set(m.id, m);
    const mods = (line.modifierIds ?? []).map((id) => {
      const m = allowed.get(id);
      if (!m) throw new Error(`Μη έγκυρη επιλογή για «${product.name}»`);
      return m;
    });
    return { line, product, mods };
  });
}

export type SendRoundCtx = {
  sessionId: number;
  roundNo: number;
  tableName: string;
  orderType: OrderType;
  label: string | null;
  /** Το μπαρ του χώρου του τραπεζιού (τα ροφήματα τυπώνονται εκεί). null για πακέτο/ταμείο. */
  areaBarStationId: number | null;
  buzzerNo?: number | null;
  customerName?: string | null;
  /** Ετικέτα τύπου στο δελτίο κουζίνας αντί για ΤΡΑΠΕΖΙ/ΠΑΚΕΤΟ (π.χ. «ΤΑΜΕΙΟ»). */
  typeLabel?: string | null;
  employee: { id: number; name: string };
  resolved: ResolvedLine[];
  notes?: string | null;
  stations: RoundContext["stations"];
  now: Date;
};

/**
 * Γράφει έναν γύρο μέσα σε ΥΠΑΡΧΟΥΣΑ συναλλαγή: παραγγελία, είδη, επιλογές, κινήσεις αποθήκης, δελτία κουζίνας/μπαρ.
 * Όλα με ομαδικές εγγραφές (σταθερό πλήθος ερωτημάτων, ανεξάρτητο από το μέγεθος του καλαθιού).
 * Το χρησιμοποιούν το sendRound (σερβιτόρος/QR) και η γρήγορη πώληση του ταμείου.
 */
export async function sendRoundTx(tx: DbLike, ctx: SendRoundCtx) {
  const stationById = new Map(ctx.stations.map((s) => [s.id, s]));
  const resolveStation = (id: number | null) => {
    if (id === null) return null;
    const st = stationById.get(id);
    if (st?.kind === "bar" && ctx.areaBarStationId && stationById.has(ctx.areaBarStationId)) return ctx.areaBarStationId;
    return id;
  };
  const [order] = await tx
    .insert(schema.orders)
    .values({ sessionId: ctx.sessionId, roundNo: ctx.roundNo, employeeId: ctx.employee.id, notes: ctx.notes?.trim() || null, createdAt: ctx.now })
    .returning();

  const rows = ctx.resolved.map(({ line, product }) => ({
    orderId: order.id,
    sessionId: ctx.sessionId,
    productId: product.id,
    nameSnapshot: product.name,
    unitPriceCents: product.priceCents,
    qty: line.qty,
    vatRateId: product.vatRateId,
    vatRatePct: product.vatRate.ratePct,
    course: line.course ?? 1,
    notes: line.notes?.trim() || null,
    status: "sent" as const,
    printStationId: resolveStation(product.printStationId ?? product.category.printStationId ?? null),
    sentAt: ctx.now,
  }));
  // Η Postgres δίνει τα id με τη σειρά των VALUES· ταξινομούμε κατά id και επαληθεύουμε ότι κάθε γραμμή αντιστοιχεί στο είδος της.
  const items = (await tx.insert(schema.orderItems).values(rows).returning()).sort((a, b) => a.id - b.id);
  if (items.length !== rows.length || items.some((it, i) => it.productId !== rows[i].productId || it.qty !== rows[i].qty)) {
    throw new Error("Η παραγγελία δεν καταχωρήθηκε σωστά. Δοκίμασε ξανά.");
  }

  const modRows = ctx.resolved.flatMap(({ mods }, i) =>
    mods.map((m) => ({ orderItemId: items[i].id, modifierId: m.id, nameSnapshot: m.name, priceDeltaCents: m.priceDeltaCents })),
  );
  if (modRows.length) await tx.insert(schema.orderItemModifiers).values(modRows);

  await applyRecipeMovementsBatch(
    tx,
    ctx.resolved.map(({ line, product, mods }, i) => ({ productId: product.id, modifierIds: mods.map((m) => m.id), qty: line.qty, refId: items[i].id })),
    { kind: "sale", refType: "order_item", employeeId: ctx.employee.id },
  );

  const byStation = new Map<number, KitchenItem[]>();
  ctx.resolved.forEach(({ line, product, mods }, i) => {
    const stationId = items[i].printStationId;
    if (stationId === null || !stationById.has(stationId)) return;
    const arr = byStation.get(stationId) ?? [];
    arr.push({ qty: line.qty, name: product.name, modifiers: mods.map((m) => m.name), notes: items[i].notes, course: items[i].course });
    byStation.set(stationId, arr);
  });
  await enqueueMany(
    tx,
    [...byStation].map(([stationId, kitchenItems]) => {
      const station = stationById.get(stationId)!;
      return {
        station,
        kind: "kitchen_ticket" as const,
        doc: kitchenTicket({
          stationName: station.name,
          tableName: ctx.tableName,
          orderType: ctx.orderType,
          label: ctx.label,
          waiter: ctx.employee.name,
          roundNo: ctx.roundNo,
          time: ctx.now,
          items: kitchenItems,
          notes: ctx.notes,
          buzzerNo: ctx.buzzerNo ?? null,
          customerName: ctx.customerName ?? null,
          typeLabel: ctx.typeLabel ?? null,
        }),
      };
    }),
  );

  const fiscalLines: FiscalLine[] = ctx.resolved.map(({ line, product, mods }) => ({
    name: product.name,
    qty: line.qty,
    unitPriceCents: product.priceCents + mods.reduce((n, m) => n + m.priceDeltaCents, 0),
    vatRatePct: Number(product.vatRate.ratePct),
    mydataVatCategory: product.vatRate.mydataCategory,
  }));
  return { order, items, fiscalLines };
}

/** Δελτίο παραγγελίας εστίασης (8.6), ΜΕΤΑ το commit. Στη Φάση 1 απλώς καταγράφεται ως "not_required". */
export async function recordOrderSlip(input: { sessionId: number; orderId: number; tableName: string; employeeName: string; lines: FiscalLine[]; issuedAt: Date }) {
  const db = await getDb();
  const fiscal = await getFiscalProvider().issueOrderSlip(input);
  await db.insert(schema.fiscalDocuments).values({
    sessionId: input.sessionId,
    orderId: input.orderId,
    kind: "order_slip_8_6",
    status: fiscal.status,
    provider: fiscal.provider,
    mark: fiscal.status === "issued" ? fiscal.mark ?? null : null,
    uid: fiscal.status === "issued" ? fiscal.uid ?? null : null,
    payload: fiscal.status === "not_required" ? { note: fiscal.note } : fiscal.status === "issued" ? (fiscal.raw as object) ?? null : null,
    error: fiscal.status === "failed" ? fiscal.error : null,
    issuedAt: fiscal.status === "issued" ? input.issuedAt : null,
  });
}

/**
 * Αποστολή γύρου παραγγελίας: εγγραφή, αφαίρεση αποθέματος, δελτίο παραγγελίας, εκτύπωση κουζίνας.
 * opts.barStationId: το μπαρ για τα ροφήματα (π.χ. της βάρδιας του ταμείου που δέχεται το QR)· αλλιώς το μπαρ του χώρου του τραπεζιού.
 */
export async function sendRound(sessionId: number, cart: CartLine[], employeeId: number, notes?: string | null, opts: { barStationId?: number | null } = {}) {
  const db = await getDb();
  const lines = cart.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Η παραγγελία είναι κενή");
  const [session, employee, round] = await Promise.all([
    db.query.tableSessions.findFirst({
      where: eq(schema.tableSessions.id, sessionId),
      with: { table: { with: { area: true } }, orders: true },
    }),
    db.query.employees.findFirst({ where: eq(schema.employees.id, employeeId) }),
    loadRoundContext(db, lines),
  ]);
  if (!session) throw new Error("Η συνεδρία δεν βρέθηκε");
  if (session.status === "closed" || session.status === "cancelled") throw new Error("Η συνεδρία έχει κλείσει");
  if (!employee) throw new Error("Άγνωστος υπάλληλος");
  const resolved = resolveLines(lines, round.products);

  const roundNo = session.orders.length + 1;
  const tableName = session.table ? session.table.name : session.label ?? `#${session.id}`;
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const r = await sendRoundTx(tx, {
      sessionId,
      roundNo,
      tableName,
      orderType: session.orderType,
      label: session.label,
      // Ροφήματα: στο μπαρ που δόθηκε (QR → μπαρ του ταμείου που το δέχεται), αλλιώς στο μπαρ του χώρου του τραπεζιού.
      areaBarStationId: opts.barStationId ?? session.table?.area?.barStationId ?? null,
      buzzerNo: session.buzzerNo,
      customerName: session.customerName,
      typeLabel: session.source === "till" ? TILL_TYPE_LABEL : null,
      employee,
      resolved,
      notes,
      stations: round.stations,
      now,
    });
    if (session.status === "billed") {
      await tx.update(schema.tableSessions).set({ status: "open" }).where(eq(schema.tableSessions.id, sessionId));
    }
    return r;
  });

  await recordOrderSlip({ sessionId, orderId: result.order.id, tableName, employeeName: employee.name, lines: result.fiscalLines, issuedAt: now });

  await refreshSessionReadiness(sessionId);
  emit({ type: "print.changed" });
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
  emit({ type: "kds.changed" });
  emit({ type: "stock.changed" });
  return result.order;
}

export async function voidItem(itemId: number, reason: string, employeeId: number) {
  const db = await getDb();
  if (!reason.trim()) throw new Error("Απαιτείται αιτία ακύρωσης");
  const item = await db.query.orderItems.findFirst({
    where: eq(schema.orderItems.id, itemId),
    with: { modifiers: true, session: { with: { table: true } }, printStation: true },
  });
  if (!item) throw new Error("Το είδος δεν βρέθηκε");
  if (item.status === "voided") throw new Error("Έχει ήδη ακυρωθεί");
  if (item.session.status === "closed" || item.session.status === "cancelled") throw new Error("Η συνεδρία έχει κλείσει");
  const employee = await db.query.employees.findFirst({ where: eq(schema.employees.id, employeeId) });
  await db.transaction(async (tx) => {
    await tx
      .update(schema.orderItems)
      .set({ status: "voided", voidedAt: new Date(), voidedBy: employeeId, voidReason: reason.trim() })
      .where(eq(schema.orderItems.id, itemId));
    await applyRecipeMovements(tx, {
      productId: item.productId,
      modifierIds: item.modifiers.map((m) => m.modifierId).filter((x): x is number => x !== null),
      qty: item.qty,
      kind: "void_reversal",
      refType: "order_item",
      refId: item.id,
      employeeId,
    });
    await audit(tx, employeeId, "void_item", "order_item", itemId, {
      name: item.nameSnapshot,
      qty: item.qty,
      unitPriceCents: item.unitPriceCents,
      reason,
      sessionId: item.sessionId,
    });
    if (item.printStation && item.printStation.enabled && item.status !== "served") {
      await enqueue(
        tx,
        item.printStation.id,
        "void_ticket",
        voidTicket({
          stationName: item.printStation.name,
          tableName: item.session.table ? item.session.table.name : item.session.label ?? `#${item.sessionId}`,
          waiter: employee?.name ?? "",
          time: new Date(),
          item: { qty: item.qty, name: item.nameSnapshot, modifiers: item.modifiers.map((m) => m.nameSnapshot), notes: item.notes, course: item.course },
          reason,
          buzzerNo: item.session.buzzerNo,
        }),
      );
    }
  });
  emit({ type: "print.changed" });
  emit({ type: "session.changed", sessionId: item.sessionId });
  emit({ type: "floor.changed" });
  emit({ type: "kds.changed" });
  emit({ type: "stock.changed" });
}

export async function cancelSession(sessionId: number, reason: string, employeeId: number) {
  const db = await getDb();
  const s = await getSessionDetail(sessionId);
  if (!s) throw new Error("Η συνεδρία δεν βρέθηκε");
  if (s.status === "closed" || s.status === "cancelled") throw new Error("Η συνεδρία έχει ήδη κλείσει");
  if (s.items.some((i) => i.status !== "voided")) throw new Error("Ακύρωσε πρώτα όλα τα είδη του τραπεζιού");
  if (s.payments.length) throw new Error("Υπάρχουν πληρωμές· δεν μπορεί να ακυρωθεί");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.tableSessions)
      .set({ status: "cancelled", closedAt: new Date(), closedBy: employeeId, notes: reason })
      .where(eq(schema.tableSessions.id, sessionId));
    await audit(tx, employeeId, "cancel_session", "table_session", sessionId, { reason });
  });
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
}

export async function moveSession(sessionId: number, newTableId: number, employeeId: number) {
  const db = await getDb();
  const target = await findOpenSessionForTable(newTableId);
  if (target) throw new Error("Το τραπέζι-στόχος είναι κατειλημμένο");
  await db.transaction(async (tx) => {
    await tx.update(schema.tableSessions).set({ tableId: newTableId, orderType: "dine_in" }).where(eq(schema.tableSessions.id, sessionId));
    await audit(tx, employeeId, "move_session", "table_session", sessionId, { newTableId });
  });
  emit({ type: "session.changed", sessionId });
  emit({ type: "floor.changed" });
  emit({ type: "kds.changed" });
}

/* --------------------------------- KDS --------------------------------- */

export type KdsTicket = {
  orderId: number;
  sessionId: number;
  tableName: string;
  orderType: OrderType;
  waiter: string;
  roundNo: number;
  createdAt: Date;
  notes: string | null;
  /** Αριθμός βομβητή του πελάτη (αν πήρε): όταν γίνει «ΕΤΟΙΜΟ», αυτός χτυπά. */
  buzzerNo: number | null;
  customerName: string | null;
  source: SessionSource;
  /** Η παραγγελία έχει ήδη πληρωθεί (ροή self-service: πρώτα πληρωμή, μετά ετοιμασία). */
  paid: boolean;
  items: {
    id: number;
    qty: number;
    name: string;
    modifiers: string[];
    notes: string | null;
    course: number;
    status: string;
  }[];
};

/** Ανοιχτά εισιτήρια κουζίνας: είδη σε κατάσταση sent/preparing, ανά γύρο. */
export async function getKdsTickets(stationId?: number | null): Promise<KdsTicket[]> {
  const db = await getDb();
  const where = stationId
    ? and(inArray(schema.orderItems.status, ["sent", "preparing"]), eq(schema.orderItems.printStationId, stationId))
    : inArray(schema.orderItems.status, ["sent", "preparing"]);
  const items = await db.query.orderItems.findMany({
    where,
    orderBy: [asc(schema.orderItems.id)],
    with: { modifiers: true, order: { with: { employee: true, session: { with: { table: true } } } } },
  });
  const map = new Map<number, KdsTicket>();
  for (const it of items) {
    const o = it.order;
    let t = map.get(o.id);
    if (!t) {
      t = {
        orderId: o.id,
        sessionId: o.sessionId,
        tableName: o.session.table ? o.session.table.name : o.session.label ?? `#${o.sessionId}`,
        orderType: o.session.orderType,
        waiter: o.employee.name,
        roundNo: o.roundNo,
        createdAt: o.createdAt,
        notes: o.notes,
        buzzerNo: o.session.buzzerNo,
        customerName: o.session.customerName,
        source: o.session.source,
        paid: o.session.status === "closed",
        items: [],
      };
      map.set(o.id, t);
    }
    t.items.push({
      id: it.id,
      qty: it.qty,
      name: it.nameSnapshot,
      modifiers: it.modifiers.map((m) => m.nameSnapshot),
      notes: it.notes,
      course: it.course,
      status: it.status,
    });
  }
  return [...map.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Αν όλα τα ενεργά είδη μιας συνεδρίας είναι έτοιμα/σερβιρισμένα, σημειώνει readyAt
 * (μία φορά). Το χρησιμοποιεί η σελίδα κατάστασης της παραγγελίας QR για να ειδοποιήσει τον πελάτη.
 */
export async function refreshSessionReadiness(sessionId: number) {
  const db = await getDb();
  const s = await db.query.tableSessions.findFirst({ where: eq(schema.tableSessions.id, sessionId), with: { items: true } });
  if (!s) return;
  const live = s.items.filter((i) => i.status !== "voided");
  const allReady = live.length > 0 && live.every((i) => i.status === "ready" || i.status === "served");
  if (allReady && !s.readyAt) {
    await db.update(schema.tableSessions).set({ readyAt: new Date() }).where(eq(schema.tableSessions.id, sessionId));
    emit({ type: "session.changed", sessionId });
    emit({ type: "floor.changed" });
  } else if (!allReady && s.readyAt && live.some((i) => i.status === "sent" || i.status === "preparing")) {
    // Νέος γύρος μετά την ετοιμότητα: η παραγγελία δεν είναι πια πλήρως έτοιμη.
    await db.update(schema.tableSessions).set({ readyAt: null }).where(eq(schema.tableSessions.id, sessionId));
    emit({ type: "session.changed", sessionId });
  }
}

export async function setItemStatus(itemId: number, status: "preparing" | "ready" | "served") {
  const db = await getDb();
  const set: Partial<typeof schema.orderItems.$inferInsert> = { status };
  if (status === "ready") set.readyAt = new Date();
  if (status === "served") set.servedAt = new Date();
  const [row] = await db
    .update(schema.orderItems)
    .set(set)
    .where(and(eq(schema.orderItems.id, itemId), sql`${schema.orderItems.status} <> 'voided'`))
    .returning();
  if (row) {
    emit({ type: "kds.changed" });
    emit({ type: "session.changed", sessionId: row.sessionId });
    await refreshSessionReadiness(row.sessionId);
  }
  return row;
}

/**
 * «Bump»: όλα τα είδη ενός γύρου (για έναν σταθμό) γίνονται έτοιμα.
 * Επιστρέφει αν ΟΛΗ η παραγγελία είναι πια έτοιμη (όλοι οι σταθμοί) και τον βομβητή της: τότε χτυπά ο βομβητής.
 */
export async function bumpOrder(orderId: number, stationId?: number | null): Promise<{ sessionId: number; allReady: boolean; buzzerNo: number | null; name: string } | null> {
  const db = await getDb();
  const where = stationId
    ? and(eq(schema.orderItems.orderId, orderId), eq(schema.orderItems.printStationId, stationId), inArray(schema.orderItems.status, ["sent", "preparing"]))
    : and(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.status, ["sent", "preparing"]));
  await db.update(schema.orderItems).set({ status: "ready", readyAt: new Date() }).where(where);
  emit({ type: "kds.changed" });
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId), with: { session: { with: { table: true, items: { columns: { status: true } } } } } });
  if (!o) return null;
  emit({ type: "session.changed", sessionId: o.sessionId });
  await refreshSessionReadiness(o.sessionId);
  const live = o.session.items.filter((i) => i.status !== "voided");
  return {
    sessionId: o.sessionId,
    allReady: live.length > 0 && live.every((i) => i.status === "ready" || i.status === "served"),
    buzzerNo: o.session.buzzerNo,
    name: o.session.table ? o.session.table.name : o.session.label ?? `#${o.sessionId}`,
  };
}

/** Όλα τα είδη μιας συνεδρίας γίνονται «έτοιμα» (π.χ. από το ταμείο, για ειδοποίηση πελάτη QR). */
export async function markSessionReady(sessionId: number) {
  const db = await getDb();
  await db
    .update(schema.orderItems)
    .set({ status: "ready", readyAt: new Date() })
    .where(and(eq(schema.orderItems.sessionId, sessionId), inArray(schema.orderItems.status, ["sent", "preparing"])));
  emit({ type: "kds.changed" });
  emit({ type: "session.changed", sessionId });
  await refreshSessionReadiness(sessionId);
}

export async function markServed(sessionId: number) {
  const db = await getDb();
  await db
    .update(schema.orderItems)
    .set({ status: "served", servedAt: new Date() })
    .where(and(eq(schema.orderItems.sessionId, sessionId), eq(schema.orderItems.status, "ready")));
  emit({ type: "session.changed", sessionId });
}

export type { DbLike };
