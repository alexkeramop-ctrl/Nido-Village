/**
 * Παραγγελιοληψία: άνοιγμα τραπεζιού, αποστολή γύρου, ακυρώσεις, KDS.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type DbLike } from "@/server/audit";
import { emit } from "@/server/events";
import { getFiscalProvider } from "@/server/fiscal/provider";
import { enqueue } from "@/server/printing/queue";
import { kitchenTicket, voidTicket, type KitchenItem } from "@/server/printing/templates";
import type { OrderType } from "@/db/schema";
import { applyRecipeMovements } from "./inventory";
import { findOpenSessionForTable } from "./floor";
import { getSessionDetail } from "./billing";

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

async function stationForProduct(p: { printStationId: number | null; category: { printStationId: number | null } }) {
  return p.printStationId ?? p.category.printStationId ?? null;
}

/** Αποστολή γύρου παραγγελίας: εγγραφή, αφαίρεση αποθέματος, δελτίο παραγγελίας, εκτύπωση κουζίνας. */
export async function sendRound(sessionId: number, cart: CartLine[], employeeId: number, notes?: string | null) {
  const db = await getDb();
  const lines = cart.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Η παραγγελία είναι κενή");
  const session = await db.query.tableSessions.findFirst({
    where: eq(schema.tableSessions.id, sessionId),
    with: { table: true, orders: true },
  });
  if (!session) throw new Error("Η συνεδρία δεν βρέθηκε");
  if (session.status === "closed" || session.status === "cancelled") throw new Error("Η συνεδρία έχει κλείσει");
  const employee = await db.query.employees.findFirst({ where: eq(schema.employees.id, employeeId) });
  if (!employee) throw new Error("Άγνωστος υπάλληλος");

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await db.query.products.findMany({
    where: and(inArray(schema.products.id, productIds), eq(schema.products.active, true)),
    with: { category: true, vatRate: true, modifierGroups: { with: { group: { with: { modifiers: true } } } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) throw new Error(`Το είδος ${l.productId} δεν είναι διαθέσιμο`);
    if (!p.available) throw new Error(`Το είδος «${p.name}» έχει εξαντληθεί`);
  }

  const stations = await db.query.printStations.findMany({ where: eq(schema.printStations.enabled, true) });
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const roundNo = session.orders.length + 1;
  const tableName = session.table ? session.table.name : session.label ?? `#${session.id}`;
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(schema.orders)
      .values({ sessionId, roundNo, employeeId, notes: notes?.trim() || null })
      .returning();
    const byStation = new Map<number, KitchenItem[]>();
    const fiscalLines = [];
    for (const l of lines) {
      const p = byId.get(l.productId)!;
      const allowedMods = new Map<number, { id: number; name: string; priceDeltaCents: number }>();
      for (const pg of p.modifierGroups) for (const m of pg.group.modifiers) if (m.active) allowedMods.set(m.id, m);
      const mods = (l.modifierIds ?? []).map((id) => {
        const m = allowedMods.get(id);
        if (!m) throw new Error(`Μη έγκυρη επιλογή για «${p.name}»`);
        return m;
      });
      const stationId = await stationForProduct(p);
      const [item] = await tx
        .insert(schema.orderItems)
        .values({
          orderId: order.id,
          sessionId,
          productId: p.id,
          nameSnapshot: p.name,
          unitPriceCents: p.priceCents,
          qty: l.qty,
          vatRateId: p.vatRateId,
          vatRatePct: p.vatRate.ratePct,
          course: l.course ?? 1,
          notes: l.notes?.trim() || null,
          status: "sent",
          printStationId: stationId,
          sentAt: now,
        })
        .returning();
      if (mods.length) {
        await tx.insert(schema.orderItemModifiers).values(
          mods.map((m) => ({ orderItemId: item.id, modifierId: m.id, nameSnapshot: m.name, priceDeltaCents: m.priceDeltaCents })),
        );
      }
      await applyRecipeMovements(tx, {
        productId: p.id,
        modifierIds: mods.map((m) => m.id),
        qty: l.qty,
        kind: "sale",
        refType: "order_item",
        refId: item.id,
        employeeId,
      });
      if (stationId && stationById.has(stationId)) {
        const arr = byStation.get(stationId) ?? [];
        arr.push({ qty: l.qty, name: p.name, modifiers: mods.map((m) => m.name), notes: item.notes, course: item.course });
        byStation.set(stationId, arr);
      }
      fiscalLines.push({
        name: p.name,
        qty: l.qty,
        unitPriceCents: p.priceCents + mods.reduce((n, m) => n + m.priceDeltaCents, 0),
        vatRatePct: Number(p.vatRate.ratePct),
        mydataVatCategory: p.vatRate.mydataCategory,
      });
    }
    for (const [stationId, items] of byStation) {
      const st = stationById.get(stationId)!;
      await enqueue(
        tx,
        stationId,
        "kitchen_ticket",
        kitchenTicket({
          stationName: st.name,
          tableName,
          orderType: session.orderType,
          label: session.label,
          waiter: employee.name,
          roundNo,
          time: now,
          items,
          notes,
        }),
      );
    }
    if (session.status === "billed") {
      await tx.update(schema.tableSessions).set({ status: "open" }).where(eq(schema.tableSessions.id, sessionId));
    }
    return { order, fiscalLines };
  });

  // Δελτίο παραγγελίας εστίασης (8.6). Στη Φάση 1 απλώς καταγράφεται ως "not_required".
  const fiscal = await getFiscalProvider().issueOrderSlip({
    sessionId,
    orderId: result.order.id,
    tableName,
    employeeName: employee.name,
    lines: result.fiscalLines,
    issuedAt: now,
  });
  await db.insert(schema.fiscalDocuments).values({
    sessionId,
    orderId: result.order.id,
    kind: "order_slip_8_6",
    status: fiscal.status,
    provider: fiscal.provider,
    mark: fiscal.status === "issued" ? fiscal.mark ?? null : null,
    uid: fiscal.status === "issued" ? fiscal.uid ?? null : null,
    payload: fiscal.status === "not_required" ? { note: fiscal.note } : fiscal.status === "issued" ? (fiscal.raw as object) ?? null : null,
    error: fiscal.status === "failed" ? fiscal.error : null,
    issuedAt: fiscal.status === "issued" ? now : null,
  });

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

/** «Bump»: όλα τα είδη ενός γύρου (για έναν σταθμό) γίνονται έτοιμα. */
export async function bumpOrder(orderId: number, stationId?: number | null) {
  const db = await getDb();
  const where = stationId
    ? and(eq(schema.orderItems.orderId, orderId), eq(schema.orderItems.printStationId, stationId), inArray(schema.orderItems.status, ["sent", "preparing"]))
    : and(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.status, ["sent", "preparing"]));
  await db.update(schema.orderItems).set({ status: "ready", readyAt: new Date() }).where(where);
  emit({ type: "kds.changed" });
  const o = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (o) {
    emit({ type: "session.changed", sessionId: o.sessionId });
    await refreshSessionReadiness(o.sessionId);
  }
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
