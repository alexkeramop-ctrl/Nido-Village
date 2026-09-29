/**
 * Παραγγελία πελάτη από QR (take away / παραλαβή από το ταμείο).
 * Ο πελάτης βλέπει το μενού, παραγγέλνει, παίρνει κωδικό παραλαβής και σελίδα κατάστασης.
 * Η πληρωμή γίνεται στο ταμείο κατά την παραλαβή (Φάση 1).
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";
import { getMenu } from "./catalog";
import { openSession, sendRound, type CartLine } from "./ordering";
import { getSessionDetail, lineTotalCents } from "./billing";
import { athensDayStart, todayAthens } from "./reports";

export const QR_EMPLOYEE_NAME = "Πελάτης QR";
const MAX_LINES = 30;
const MAX_QTY = 20;

/** Ο «υπάλληλος συστήματος» στον οποίο χρεώνονται οι παραγγελίες QR. Ανενεργός, δεν μπορεί να συνδεθεί. */
export async function getQrEmployeeId(): Promise<number> {
  const db = await getDb();
  const existing = await db.query.employees.findFirst({ where: eq(schema.employees.name, QR_EMPLOYEE_NAME) });
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.employees)
    .values({ name: QR_EMPLOYEE_NAME, role: "waiter", pinHash: `system:${randomBytes(16).toString("hex")}`, active: false })
    .returning();
  return row.id;
}

/** Μενού για τη δημόσια σελίδα: μόνο διαθέσιμα είδη, χωρίς κατηγορίες που έμειναν άδειες. */
export async function getPublicMenu() {
  const menu = await getMenu();
  return menu
    .map((c) => ({ ...c, products: c.products.filter((p) => p.available) }))
    .filter((c) => c.products.length > 0);
}

async function nextPickupCode(): Promise<string> {
  const db = await getDb();
  const start = athensDayStart(todayAthens());
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tableSessions)
    .where(and(eq(schema.tableSessions.source, "qr"), gte(schema.tableSessions.openedAt, start)));
  return String((n ?? 0) + 1).padStart(3, "0");
}

export type QrOrderInput = {
  customerName: string;
  customerPhone?: string | null;
  notes?: string | null;
  lines: CartLine[];
};

export async function placeQrOrder(input: QrOrderInput) {
  const name = (input.customerName ?? "").trim();
  if (name.length < 2 || name.length > 40) throw new Error("Δώσε το όνομά σου (2–40 χαρακτήρες)");
  const phone = (input.customerPhone ?? "").replace(/\s+/g, "").trim();
  if (phone && !/^\+?\d{10,14}$/.test(phone)) throw new Error("Μη έγκυρο τηλέφωνο");
  const lines = (input.lines ?? []).filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Το καλάθι είναι άδειο");
  if (lines.length > MAX_LINES) throw new Error("Πάρα πολλά είδη σε μία παραγγελία");
  if (lines.some((l) => l.qty > MAX_QTY)) throw new Error(`Έως ${MAX_QTY} τεμάχια ανά είδος`);

  const db = await getDb();
  const employeeId = await getQrEmployeeId();
  const code = await nextPickupCode();
  const token = randomBytes(18).toString("base64url");
  const session = await openSession({ orderType: "takeaway", label: `#${code} ${name}` }, employeeId);
  await db
    .update(schema.tableSessions)
    .set({ source: "qr", publicToken: token, pickupCode: code, customerName: name, customerPhone: phone || null })
    .where(eq(schema.tableSessions.id, session.id));
  try {
    await sendRound(
      session.id,
      lines.map((l) => ({ productId: l.productId, qty: Math.min(MAX_QTY, Math.round(l.qty)), modifierIds: l.modifierIds ?? [], notes: l.notes?.slice(0, 120) ?? null, course: 1 })),
      employeeId,
      input.notes?.trim().slice(0, 200) || null,
    );
  } catch (e) {
    // Άκυρη παραγγελία: ακυρώνουμε τη συνεδρία που ανοίξαμε για να μη μείνει ορφανή.
    await db.update(schema.tableSessions).set({ status: "cancelled", closedAt: new Date() }).where(eq(schema.tableSessions.id, session.id));
    emit({ type: "floor.changed" });
    throw e;
  }
  return { sessionId: session.id, token, code };
}

export type PublicOrderStatus = "received" | "preparing" | "ready" | "picked_up" | "done" | "cancelled";

export type PublicOrder = {
  code: string;
  customerName: string;
  status: PublicOrderStatus;
  createdAt: string;
  readyAt: string | null;
  items: { name: string; qty: number; modifiers: string[]; notes: string | null; status: string; lineTotalCents: number }[];
  totalCents: number;
  paid: boolean;
  venueName?: string;
};

function statusOf(s: { status: string; readyAt: Date | null; pickedUpAt: Date | null; items: { status: string }[] }): PublicOrderStatus {
  if (s.status === "cancelled") return "cancelled";
  if (s.status === "closed") return "done";
  if (s.pickedUpAt) return "picked_up";
  const live = s.items.filter((i) => i.status !== "voided");
  if (live.length && live.every((i) => i.status === "ready" || i.status === "served")) return "ready";
  if (live.some((i) => i.status === "preparing" || i.status === "ready")) return "preparing";
  return "received";
}

/** Κατάσταση παραγγελίας για τον πελάτη (χωρίς εσωτερικά στοιχεία). */
export async function getPublicOrder(token: string): Promise<PublicOrder | null> {
  if (!token || token.length > 64) return null;
  const db = await getDb();
  const s = await db.query.tableSessions.findFirst({
    where: eq(schema.tableSessions.publicToken, token),
    with: { items: { orderBy: [asc(schema.orderItems.id)], with: { modifiers: true } }, payments: true },
  });
  if (!s) return null;
  const live = s.items.filter((i) => i.status !== "voided");
  const total = live.reduce((n, i) => n + lineTotalCents(i), 0) - s.discountCents;
  const paid = s.payments.reduce((n, p) => n + p.amountCents, 0);
  return {
    code: s.pickupCode ?? String(s.id),
    customerName: s.customerName ?? "",
    status: statusOf(s),
    createdAt: s.openedAt.toISOString(),
    readyAt: s.readyAt?.toISOString() ?? null,
    items: live.map((i) => ({
      name: i.nameSnapshot,
      qty: i.qty,
      modifiers: i.modifiers.map((m) => m.nameSnapshot),
      notes: i.notes,
      status: i.status,
      lineTotalCents: lineTotalCents(i),
    })),
    totalCents: Math.max(0, total),
    paid: paid >= total && total > 0,
  };
}

export async function getSessionIdForToken(token: string): Promise<number | null> {
  const db = await getDb();
  const s = await db.query.tableSessions.findFirst({ where: eq(schema.tableSessions.publicToken, token), columns: { id: true } });
  return s?.id ?? null;
}

/** Ο πίνακας παραλαβών (οθόνη στο ταμείο): παραγγελίες QR της ημέρας που δεν έχουν παραδοθεί. */
export async function listPickupBoard() {
  const db = await getDb();
  const start = athensDayStart(todayAthens());
  const rows = await db.query.tableSessions.findMany({
    where: and(eq(schema.tableSessions.source, "qr"), gte(schema.tableSessions.openedAt, start), inArray(schema.tableSessions.status, ["open", "billed"])),
    orderBy: [asc(schema.tableSessions.openedAt)],
    with: { items: true },
  });
  return rows
    .map((s) => ({
      sessionId: s.id,
      code: s.pickupCode ?? String(s.id),
      customerName: s.customerName ?? "",
      status: statusOf(s),
      openedAt: s.openedAt.toISOString(),
      readyAt: s.readyAt?.toISOString() ?? null,
      itemCount: s.items.filter((i) => i.status !== "voided").reduce((n, i) => n + i.qty, 0),
    }))
    .filter((r) => r.status !== "picked_up" && r.status !== "cancelled");
}

/** Το ταμείο σημειώνει ότι ο πελάτης παρέλαβε (και σερβιρίστηκαν τα είδη). */
export async function markPickedUp(sessionId: number) {
  const db = await getDb();
  await db
    .update(schema.orderItems)
    .set({ status: "served", servedAt: new Date() })
    .where(and(eq(schema.orderItems.sessionId, sessionId), inArray(schema.orderItems.status, ["sent", "preparing", "ready"])));
  await db.update(schema.tableSessions).set({ pickedUpAt: new Date() }).where(eq(schema.tableSessions.id, sessionId));
  emit({ type: "session.changed", sessionId });
  emit({ type: "kds.changed" });
  emit({ type: "floor.changed" });
}

/** Πρόσφατες παραγγελίες QR για το back-office. */
export async function listRecentQrOrders(limit = 50) {
  const db = await getDb();
  const rows = await db.query.tableSessions.findMany({
    where: eq(schema.tableSessions.source, "qr"),
    orderBy: [desc(schema.tableSessions.id)],
    limit,
    with: { items: { with: { modifiers: true } }, payments: true },
  });
  return rows.map((s) => ({
    sessionId: s.id,
    code: s.pickupCode ?? String(s.id),
    customerName: s.customerName ?? "",
    customerPhone: s.customerPhone,
    status: statusOf(s),
    openedAt: s.openedAt,
    totalCents: s.items.filter((i) => i.status !== "voided").reduce((n, i) => n + lineTotalCents(i), 0) - s.discountCents,
  }));
}

export { getSessionDetail };
