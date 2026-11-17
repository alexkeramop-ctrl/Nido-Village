/**
 * Αιτήματα κράτησης από τη φόρμα του site (POST /api/public/booking-request).
 * Δημόσιο σημείο χωρίς σύνδεση: αυστηρός έλεγχος, παγίδα για bots (honeypot) και όριο ανά IP.
 * Το αίτημα γίνεται κράτηση με κατάσταση «Αίτημα» και πηγή «website»· ο υπεύθυνος την επιβεβαιώνει ή την ακυρώνει.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { PARTY_MINUTES, addMinutes } from "@/components/admin/events/party";
import { grantMarketingConsent } from "./customers";
import { upsertEvent } from "./events";
import { addDays, todayAthens } from "./reports";

export const BOOKING_REQUEST_TYPES = ["party", "wedding", "christening"] as const;
export type BookingRequestType = (typeof BOOKING_REQUEST_TYPES)[number];

/** Έως τόσα αιτήματα ανά ώρα από την ίδια IP. */
export const BOOKING_REQUESTS_PER_HOUR = 5;
/** Πόσο μπροστά δεχόμαστε ημερομηνία (2 χρόνια). */
const MAX_DAYS_AHEAD = 730;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BookingRequest = {
  type: BookingRequestType;
  date: string;
  name: string;
  phone: string;
  email: string | null;
  kids: number;
  adults: number;
  message: string | null;
  consent: boolean;
};

export type BookingRequestErrors = Partial<Record<"type" | "date" | "name" | "phone" | "email" | "kids" | "adults" | "message" | "consent" | "body", string>>;

function isRealDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** Ακέραιος 0..max από αριθμό ή κείμενο με ψηφία· undefined αν δεν είναι έγκυρο. */
function count(v: unknown, max: number): number | undefined {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
}

/** true όταν το πεδίο-παγίδα «website» έχει συμπληρωθεί (το συμπληρώνουν μόνο bots). */
export function isHoneypotFilled(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const w = (payload as Record<string, unknown>).website;
  return w !== undefined && w !== null && String(w).trim() !== "";
}

/** Αυστηρός έλεγχος του αιτήματος. Τα άγνωστα πεδία αγνοούνται. */
export function validateBookingRequest(payload: unknown, today: string = todayAthens()): { ok: true; data: BookingRequest } | { ok: false; errors: BookingRequestErrors } {
  const errors: BookingRequestErrors = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, errors: { body: "Μη έγκυρο αίτημα" } };
  const p = payload as Record<string, unknown>;

  const type = p.type;
  if (typeof type !== "string" || !(BOOKING_REQUEST_TYPES as readonly string[]).includes(type)) errors.type = "Επίλεξε είδος εκδήλωσης (πάρτι, γάμος ή βάπτιση)";

  const date = typeof p.date === "string" ? p.date.trim() : "";
  if (!isRealDate(date)) errors.date = "Μη έγκυρη ημερομηνία";
  else if (date < today) errors.date = "Η ημερομηνία έχει περάσει";
  else if (date > addDays(today, MAX_DAYS_AHEAD)) errors.date = "Η ημερομηνία είναι πολύ μακριά";

  const name = typeof p.name === "string" ? p.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 80) errors.name = "Γράψε το ονοματεπώνυμό σου (2–80 χαρακτήρες)";
  else if (!/\p{L}/u.test(name) || /[<>]|https?:|www\./i.test(name)) errors.name = "Μη έγκυρο όνομα";

  const phone = typeof p.phone === "string" || typeof p.phone === "number" ? normalizePhone(String(p.phone)) : "";
  if (!isValidPhone(phone)) errors.phone = "Μη έγκυρο τηλέφωνο (π.χ. 6912345678)";

  let email: string | null = null;
  if (p.email !== undefined && p.email !== null && p.email !== "") {
    const e = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
    if (!e || e.length > 160 || !EMAIL_RE.test(e)) errors.email = "Μη έγκυρο email";
    else email = e;
  }

  const kids = count(p.kids, 500);
  if (kids === undefined) errors.kids = "Μη έγκυρος αριθμός παιδιών";
  const adults = count(p.adults, 2000);
  if (adults === undefined) errors.adults = "Μη έγκυρος αριθμός ενηλίκων";

  let message: string | null = null;
  if (p.message !== undefined && p.message !== null && p.message !== "") {
    if (typeof p.message !== "string" || p.message.length > 1000) errors.message = "Το μήνυμα είναι πολύ μεγάλο (έως 1000 χαρακτήρες)";
    else message = p.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim() || null;
  }

  if (p.consent !== undefined && typeof p.consent !== "boolean") errors.consent = "Μη έγκυρη τιμή συγκατάθεσης";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: { type: type as BookingRequestType, date, name, phone, email, kids: kids ?? 0, adults: adults ?? 0, message, consent: p.consent === true },
  };
}

/** SHA-256 (WebCrypto) της IP μαζί με το μυστικό της εγκατάστασης: δεν αποθηκεύουμε ποτέ την ίδια την IP. */
export async function hashIp(ip: string): Promise<string> {
  const salt = process.env.NIDO_SECRET ?? "nido-village-dev-secret-change-me";
  const bytes = new TextEncoder().encode(`booking-request|${salt}|${ip.trim().toLowerCase()}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Όριο αιτημάτων: επιστρέφει false αν η IP έχει ήδη φτάσει το όριο της τελευταίας ώρας,
 * αλλιώς καταγράφει το αίτημα και επιστρέφει true. Σβήνει και τις εγγραφές παλαιότερες της μίας ημέρας.
 */
export async function takeRateLimitSlot(ipHash: string, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  const hits = schema.bookingRequestHits;
  await db.delete(hits).where(lt(hits.createdAt, new Date(now.getTime() - 24 * 3600_000)));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hits)
    .where(and(eq(hits.ipHash, ipHash), gte(hits.createdAt, new Date(now.getTime() - 3600_000))));
  if ((n ?? 0) >= BOOKING_REQUESTS_PER_HOUR) return false;
  await db.insert(hits).values({ ipHash, createdAt: now });
  return true;
}

const TITLE_PREFIX = "Αίτημα από site";

/** Δημιουργεί την κράτηση (κατάσταση «Αίτημα», πηγή «website») και τον πελάτη της. */
export async function createBookingRequest(data: BookingRequest) {
  const isParty = data.type === "party";
  const startTime = isParty ? "11:00" : "12:00";
  const noteLines = [
    `Αίτημα από τη φόρμα του site.`,
    data.message ? `Μήνυμα πελάτη: ${data.message}` : null,
    `Συγκατάθεση για ενημερώσεις: ${data.consent ? "ναι" : "όχι"}`,
  ].filter(Boolean);
  const event = await upsertEvent(
    {
      title: `${TITLE_PREFIX}: ${data.name}`,
      type: data.type,
      status: "inquiry",
      source: "website",
      date: data.date,
      startTime,
      // Γάμοι/βαπτίσεις κρατούν τον χώρο ως το τέλος της ημέρας· τα πάρτι διαρκούν 2,5 ώρες.
      endTime: isParty ? addMinutes(startTime, PARTY_MINUTES) : "23:59",
      guests: data.kids + data.adults,
      customerName: data.name,
      customerPhone: data.phone,
      customerEmail: data.email,
      notes: noteLines.join("\n"),
      party: isParty ? { kids: data.kids, adults: data.adults, childName: "", childAge: null, package: "", adultMenu: "none", extras: [], theme: "", cake: "" } : null,
    },
    null,
  );
  if (data.consent && event.customerId != null) await grantMarketingConsent(event.customerId);
  const db = await getDb();
  await audit(db, null, "booking_request", "event", event.id, { type: data.type, date: data.date, consent: data.consent });
  return event;
}

export type BookingRequestOutcome =
  | { status: 200; body: { ok: true } }
  | { status: 400; body: { ok: false; error: "invalid"; fields: BookingRequestErrors } }
  | { status: 429; body: { ok: false; error: "rate_limited"; message: string } };

/**
 * Ολόκληρη η ροή ενός αιτήματος: παγίδα bots → έλεγχος → όριο ανά IP → δημιουργία.
 * Τα bots που συμπληρώνουν την παγίδα παίρνουν «ok» χωρίς να δημιουργηθεί τίποτα.
 */
export async function handleBookingRequest(payload: unknown, ip: string): Promise<BookingRequestOutcome> {
  if (isHoneypotFilled(payload)) return { status: 200, body: { ok: true } };
  const v = validateBookingRequest(payload);
  if (!v.ok) return { status: 400, body: { ok: false, error: "invalid", fields: v.errors } };
  if (!(await takeRateLimitSlot(await hashIp(ip)))) {
    return { status: 429, body: { ok: false, error: "rate_limited", message: "Έχουν σταλεί πολλά αιτήματα. Δοκίμασε ξανά σε λίγο ή πάρε μας τηλέφωνο." } };
  }
  await createBookingRequest(v.data);
  return { status: 200, body: { ok: true } };
}
