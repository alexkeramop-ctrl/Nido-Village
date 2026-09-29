/** Ημερολόγιο εκδηλώσεων: γάμοι, βαφτίσεις, πάρτι, σχολικές εκδρομές, εταιρικά. */
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { emit } from "@/server/events";
import type { EventStatus, EventType } from "@/db/schema";
import { addDays, todayAthens } from "./reports";

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  wedding: "Γάμος",
  christening: "Βάφτιση",
  party: "Πάρτι",
  school_trip: "Σχολική εκδρομή",
  corporate: "Εταιρικό",
  other: "Άλλο",
};
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  inquiry: "Αίτημα",
  confirmed: "Επιβεβαιωμένο",
  cancelled: "Ακυρωμένο",
  done: "Ολοκληρώθηκε",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type EventInput = {
  id?: number;
  title: string;
  type: EventType;
  status?: EventStatus;
  date: string;
  startTime?: string;
  endTime?: string;
  guests?: number;
  areaId?: number | null;
  customerName?: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  priceCents?: number;
  depositCents?: number;
  depositPaid?: boolean;
  menuNotes?: string | null;
  notes?: string | null;
};

export async function upsertEvent(input: EventInput, employeeId: number) {
  const db = await getDb();
  const title = input.title.trim();
  if (!title) throw new Error("Απαιτείται τίτλος εκδήλωσης");
  if (!isValidDate(input.date)) throw new Error("Μη έγκυρη ημερομηνία");
  const startTime = input.startTime ?? "12:00";
  const endTime = input.endTime ?? "16:00";
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error("Μη έγκυρη ώρα");
  if (!(input.type in EVENT_TYPE_LABEL)) throw new Error("Μη έγκυρος τύπος εκδήλωσης");
  const values = {
    title,
    type: input.type,
    status: input.status ?? "inquiry",
    date: input.date,
    startTime,
    endTime,
    guests: Math.max(0, Math.round(input.guests ?? 0)),
    areaId: input.areaId ?? null,
    customerName: (input.customerName ?? "").trim(),
    customerPhone: input.customerPhone?.trim() || null,
    customerEmail: input.customerEmail?.trim() || null,
    priceCents: Math.max(0, Math.round(input.priceCents ?? 0)),
    depositCents: Math.max(0, Math.round(input.depositCents ?? 0)),
    depositPaid: input.depositPaid ?? false,
    menuNotes: input.menuNotes?.trim() || null,
    notes: input.notes?.trim() || null,
    updatedAt: new Date(),
  };
  const [row] = input.id
    ? await db.update(schema.events).set(values).where(eq(schema.events.id, input.id)).returning()
    : await db.insert(schema.events).values({ ...values, createdBy: employeeId }).returning();
  if (!row) throw new Error("Η εκδήλωση δεν βρέθηκε");
  await audit(db, employeeId, input.id ? "event_update" : "event_create", "event", row.id, { title, date: row.date, status: row.status });
  emit({ type: "catalog.changed" });
  return row;
}

export async function setEventStatus(id: number, status: EventStatus, employeeId: number) {
  const db = await getDb();
  if (!(status in EVENT_STATUS_LABEL)) throw new Error("Μη έγκυρη κατάσταση");
  const [row] = await db.update(schema.events).set({ status, updatedAt: new Date() }).where(eq(schema.events.id, id)).returning();
  if (!row) throw new Error("Η εκδήλωση δεν βρέθηκε");
  await audit(db, employeeId, "event_status", "event", id, { status });
  emit({ type: "catalog.changed" });
  return row;
}

export async function deleteEvent(id: number, employeeId: number) {
  const db = await getDb();
  const e = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
  if (!e) throw new Error("Η εκδήλωση δεν βρέθηκε");
  await db.delete(schema.events).where(eq(schema.events.id, id));
  await audit(db, employeeId, "event_delete", "event", id, { title: e.title, date: e.date });
  emit({ type: "catalog.changed" });
}

/** Εκδηλώσεις σε διάστημα ημερομηνιών (συμπεριλαμβανομένων), για το ημερολόγιο. */
export async function listEvents(from: string, to: string, opts: { includeCancelled?: boolean } = {}) {
  const db = await getDb();
  const conds = [gte(schema.events.date, from), lte(schema.events.date, to)];
  if (!opts.includeCancelled) conds.push(ne(schema.events.status, "cancelled"));
  return db.query.events.findMany({
    where: and(...conds),
    orderBy: [asc(schema.events.date), asc(schema.events.startTime)],
    with: { area: true },
  });
}

/** Οι επόμενες εκδηλώσεις (από σήμερα), για επισκόπηση και dashboard συνεταίρων. */
export async function upcomingEvents(days = 30, limit = 20) {
  const today = todayAthens();
  const rows = await listEvents(today, addDays(today, days));
  return rows.slice(0, limit);
}

/** Εκδηλώσεις που συμπίπτουν σε ημερομηνία/χώρο/ώρα με τη δοθείσα (για προειδοποίηση διπλής κράτησης). */
export async function conflictingEvents(input: { id?: number; date: string; startTime: string; endTime: string; areaId?: number | null }) {
  const rows = await listEvents(input.date, input.date);
  return rows.filter(
    (e) =>
      e.id !== input.id &&
      (input.areaId == null || e.areaId == null || e.areaId === input.areaId) &&
      e.startTime < input.endTime &&
      input.startTime < e.endTime,
  );
}

export async function eventById(id: number) {
  const db = await getDb();
  return db.query.events.findFirst({ where: eq(schema.events.id, id), with: { area: true } });
}

export async function recentEvents(limit = 50) {
  const db = await getDb();
  return db.query.events.findMany({ orderBy: [desc(schema.events.date)], limit, with: { area: true } });
}
