/** Ημερολόγιο εκδηλώσεων: γάμοι, βαφτίσεις, πάρτι, σχολικές εκδρομές, εταιρικά. */
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { emit } from "@/server/events";
import type { EventSource, EventStatus, EventType, PartyDetails } from "@/db/schema";
import { ensureCustomerForBooking } from "./customers";
import { addDays, todayAthens } from "./reports";

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  wedding: "Γάμος",
  christening: "Βάφτιση",
  appointment: "Ραντεβού",
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
  /** Συμφωνημένη προκαταβολή (οι εισπράξεις καταχωρούνται ως πληρωμές, βλ. booking-payments.ts). */
  depositCents?: number;
  /** Παλιό πεδίο: αν δεν δοθεί, σε ενημέρωση μένει όπως ήταν. */
  depositPaid?: boolean;
  menuNotes?: string | null;
  notes?: string | null;
  party?: PartyDetails | null;
  /** Μόνο στη δημιουργία: "website" για αιτήματα από τη φόρμα του site. */
  source?: EventSource;
};

/** Καθαρισμός στοιχείων πάρτι (μόνο γνωστά πεδία, λογικά όρια). */
function cleanParty(p: PartyDetails | null | undefined): PartyDetails | null {
  if (!p) return null;
  const str = (v: unknown, n = 120) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const int = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);
  return {
    childName: str(p.childName),
    childAge: p.childAge == null ? null : int(p.childAge, 18),
    kids: int(p.kids, 500),
    adults: int(p.adults, 500),
    package: str(p.package, 40),
    adultMenu: str(p.adultMenu, 40),
    extras: Array.isArray(p.extras) ? p.extras.filter((x) => typeof x === "string").slice(0, 10) : [],
    theme: str(p.theme),
    cake: str(p.cake),
  };
}

/** employeeId = null για κρατήσεις που δεν τις πέρασε υπάλληλος (αίτημα από το site). */
export async function upsertEvent(input: EventInput, employeeId: number | null) {
  const db = await getDb();
  const title = input.title.trim();
  if (!title) throw new Error("Απαιτείται τίτλος εκδήλωσης");
  if (!isValidDate(input.date)) throw new Error("Μη έγκυρη ημερομηνία");
  const startTime = input.startTime ?? "12:00";
  const endTime = input.endTime ?? "16:00";
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error("Μη έγκυρη ώρα");
  if (!(input.type in EVENT_TYPE_LABEL)) throw new Error("Μη έγκυρος τύπος εκδήλωσης");
  const customerName = (input.customerName ?? "").trim();
  const customerPhone = input.customerPhone?.trim() || null;
  const customerEmail = input.customerEmail?.trim() || null;
  // Πελατολόγιο: η κράτηση συνδέεται με τον πελάτη του τηλεφώνου της (δημιουργείται αν δεν υπάρχει).
  const customerId = await ensureCustomerForBooking({ name: customerName, phone: customerPhone, email: customerEmail });
  const values = {
    title,
    type: input.type,
    status: input.status ?? "inquiry",
    date: input.date,
    startTime,
    endTime,
    guests: Math.max(0, Math.round(input.guests ?? 0)),
    areaId: input.areaId ?? null,
    customerName,
    customerPhone,
    customerEmail,
    customerId,
    priceCents: Math.max(0, Math.round(input.priceCents ?? 0)),
    depositCents: Math.max(0, Math.round(input.depositCents ?? 0)),
    ...(input.depositPaid === undefined ? {} : { depositPaid: input.depositPaid }),
    menuNotes: input.menuNotes?.trim() || null,
    notes: input.notes?.trim() || null,
    party: input.type === "party" ? cleanParty(input.party) : null,
    updatedAt: new Date(),
  };
  const [row] = input.id
    ? await db.update(schema.events).set(values).where(eq(schema.events.id, input.id)).returning()
    : await db
        .insert(schema.events)
        .values({ ...values, source: input.source === "website" ? "website" : "staff", createdBy: employeeId })
        .returning();
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
  // Οι κινήσεις εσόδων/εξόδων μένουν (ιστορικό), απλώς αποσυνδέονται από την εκδήλωση.
  await db.update(schema.financeEntries).set({ eventId: null }).where(eq(schema.financeEntries.eventId, id));
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

/** Αιτήματα από τη φόρμα του site που περιμένουν απάντηση (από σήμερα και μετά, οποιαδήποτε ημερομηνία). */
export async function pendingWebsiteRequests() {
  const db = await getDb();
  return db.query.events.findMany({
    where: and(eq(schema.events.source, "website"), eq(schema.events.status, "inquiry"), gte(schema.events.date, todayAthens())),
    orderBy: [asc(schema.events.date), asc(schema.events.startTime)],
    with: { area: true },
    limit: 100,
  });
}

export async function eventById(id: number) {
  const db = await getDb();
  return db.query.events.findFirst({ where: eq(schema.events.id, id), with: { area: true } });
}

export async function recentEvents(limit = 50) {
  const db = await getDb();
  return db.query.events.findMany({ orderBy: [desc(schema.events.date)], limit, with: { area: true } });
}
