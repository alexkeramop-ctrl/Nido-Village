/**
 * Πελατολόγιο κρατήσεων.
 * Ο πελάτης αναγνωρίζεται από το κανονικοποιημένο τηλέφωνο: κάθε κράτηση με τηλέφωνο δημιουργεί ή βρίσκει τον πελάτη της.
 */
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import type { CustomerMatch, CustomerRow } from "@/components/admin/bookings/meta";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cleanText(v: string | null | undefined, max: number): string {
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanEmail(v: string | null | undefined): string | null {
  const e = (v ?? "").trim().toLowerCase().slice(0, 160);
  return e && EMAIL_RE.test(e) ? e : null;
}

/**
 * Βρίσκει ή δημιουργεί τον πελάτη μιας κράτησης από το τηλέφωνό της και επιστρέφει το id του.
 * null όταν δεν υπάρχει έγκυρο τηλέφωνο. Σε υπάρχοντα πελάτη συμπληρώνει μόνο ό,τι λείπει (όνομα, email):
 * τα στοιχεία του αλλάζουν μόνο από το Πελατολόγιο.
 */
export async function ensureCustomerForBooking(input: { name?: string | null; phone?: string | null; email?: string | null }): Promise<number | null> {
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) return null;
  const db = await getDb();
  const name = cleanText(input.name, 120);
  const email = cleanEmail(input.email);
  const [created] = await db.insert(schema.customers).values({ name, phone, email }).onConflictDoNothing({ target: schema.customers.phone }).returning({ id: schema.customers.id });
  if (created) return created.id;
  const existing = await db.query.customers.findFirst({ where: eq(schema.customers.phone, phone) });
  if (!existing) return null;
  const patch: Partial<typeof schema.customers.$inferInsert> = {};
  if (!existing.name && name) patch.name = name;
  if (!existing.email && email) patch.email = email;
  if (Object.keys(patch).length) await db.update(schema.customers).set({ ...patch, updatedAt: new Date() }).where(eq(schema.customers.id, existing.id));
  return existing.id;
}

/** Καταγράφει συγκατάθεση για ενημερώσεις (π.χ. από τη φόρμα του site). Δεν αφαιρεί ποτέ υπάρχουσα συγκατάθεση. */
export async function grantMarketingConsent(customerId: number) {
  const db = await getDb();
  await db
    .update(schema.customers)
    .set({ marketingConsent: true, consentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.marketingConsent, false)));
}

/**
 * Συνδέει με το πελατολόγιο όσες κρατήσεις έχουν τηλέφωνο αλλά όχι πελάτη (κρατήσεις πριν από το πελατολόγιο).
 * Τρέχει όταν ανοίγει το Πελατολόγιο· δεν κάνει τίποτα όταν όλες είναι ήδη συνδεδεμένες.
 */
export async function linkUnlinkedEvents(limit = 500): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.events.id, name: schema.events.customerName, phone: schema.events.customerPhone, email: schema.events.customerEmail })
    .from(schema.events)
    .where(and(isNull(schema.events.customerId), isNotNull(schema.events.customerPhone)))
    .orderBy(desc(schema.events.date))
    .limit(limit);
  let linked = 0;
  for (const r of rows) {
    const customerId = await ensureCustomerForBooking(r);
    if (!customerId) continue;
    await db.update(schema.events).set({ customerId }).where(eq(schema.events.id, r.id));
    linked++;
  }
  return linked;
}

/** Όλοι οι πελάτες με πλήθος κρατήσεων, τελευταία κράτηση και συνολική αξία (χωρίς τις ακυρωμένες). */
export async function listCustomers(): Promise<CustomerRow[]> {
  const db = await getDb();
  const [rows, stats] = await Promise.all([
    db.select().from(schema.customers).orderBy(asc(schema.customers.name), asc(schema.customers.id)),
    db
      .select({
        customerId: schema.events.customerId,
        n: sql<number>`count(*)::int`,
        last: sql<string | null>`max(${schema.events.date})`,
        total: sql<number>`coalesce(sum(${schema.events.priceCents}), 0)::int`,
      })
      .from(schema.events)
      .where(and(isNotNull(schema.events.customerId), ne(schema.events.status, "cancelled")))
      .groupBy(schema.events.customerId),
  ]);
  const byId = new Map(stats.map((s) => [s.customerId, s]));
  return rows.map((c) => {
    const s = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      marketingConsent: c.marketingConsent,
      consentAt: c.consentAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      bookings: s?.n ?? 0,
      lastBookingDate: s?.last ?? null,
      totalBookedCents: s?.total ?? 0,
    };
  });
}

/** Ο πελάτης με αυτό το τηλέφωνο (για πρόταση στη φόρμα κράτησης), αλλιώς null. */
export async function findCustomerByPhone(rawPhone: string): Promise<CustomerMatch | null> {
  const phone = normalizePhone(rawPhone);
  if (!isValidPhone(phone)) return null;
  const db = await getDb();
  const c = await db.query.customers.findFirst({ where: eq(schema.customers.phone, phone) });
  if (!c) return null;
  const [n] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.events)
    .where(and(eq(schema.events.customerId, c.id), ne(schema.events.status, "cancelled")));
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, bookings: n?.n ?? 0, marketingConsent: c.marketingConsent };
}

export type CustomerInput = { id?: number; name: string; phone: string; email?: string | null; notes?: string | null; marketingConsent?: boolean };

export async function saveCustomer(input: CustomerInput, employeeId: number) {
  const db = await getDb();
  const name = cleanText(input.name, 120);
  if (!name) throw new Error("Απαιτείται όνομα πελάτη");
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) throw new Error("Μη έγκυρο τηλέφωνο (π.χ. 6912345678)");
  const rawEmail = (input.email ?? "").trim();
  const email = cleanEmail(rawEmail);
  if (rawEmail && !email) throw new Error("Μη έγκυρο email");
  const notes = (input.notes ?? "").trim().slice(0, 1000) || null;
  const clash = await db.query.customers.findFirst({ where: eq(schema.customers.phone, phone) });
  if (clash && clash.id !== input.id) throw new Error(`Υπάρχει ήδη πελάτης με αυτό το τηλέφωνο${clash.name ? ` (${clash.name})` : ""}`);

  if (!input.id) {
    const consent = input.marketingConsent === true;
    const [row] = await db
      .insert(schema.customers)
      .values({ name, phone, email, notes, marketingConsent: consent, consentAt: consent ? new Date() : null })
      .returning();
    await audit(db, employeeId, "customer_create", "customer", row.id, { marketingConsent: consent });
    return row;
  }
  const before = await db.query.customers.findFirst({ where: eq(schema.customers.id, input.id) });
  if (!before) throw new Error("Ο πελάτης δεν βρέθηκε");
  const consent = input.marketingConsent ?? before.marketingConsent;
  const consentAt = consent ? (before.marketingConsent ? before.consentAt : new Date()) : null;
  const [row] = await db
    .update(schema.customers)
    .set({ name, phone, email, notes, marketingConsent: consent, consentAt, updatedAt: new Date() })
    .where(eq(schema.customers.id, input.id))
    .returning();
  // Νέο τηλέφωνο: ενημερώνονται και οι κρατήσεις του, ώστε η επόμενη αποθήκευσή τους να βρίσκει τον ίδιο πελάτη.
  if (before.phone !== phone) await db.update(schema.events).set({ customerPhone: phone }).where(eq(schema.events.customerId, input.id));
  await audit(db, employeeId, "customer_update", "customer", row.id, {
    phoneChanged: before.phone !== phone,
    ...(before.marketingConsent !== consent ? { marketingConsent: consent } : {}),
  });
  return row;
}

export async function setCustomerConsent(id: number, consent: boolean, employeeId: number) {
  const db = await getDb();
  const [row] = await db
    .update(schema.customers)
    .set({ marketingConsent: consent, consentAt: consent ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.customers.id, id))
    .returning();
  if (!row) throw new Error("Ο πελάτης δεν βρέθηκε");
  await audit(db, employeeId, "customer_consent", "customer", id, { marketingConsent: consent });
  return row;
}

/** Διαγραφή πελάτη (π.χ. αίτημα διαγραφής δεδομένων). Οι κρατήσεις του μένουν, χωρίς σύνδεση με πελάτη. */
export async function deleteCustomer(id: number, employeeId: number) {
  const db = await getDb();
  const c = await db.query.customers.findFirst({ where: eq(schema.customers.id, id) });
  if (!c) throw new Error("Ο πελάτης δεν βρέθηκε");
  await db.update(schema.events).set({ customerId: null }).where(eq(schema.events.customerId, id));
  await db.delete(schema.customers).where(eq(schema.customers.id, id));
  await audit(db, employeeId, "customer_delete", "customer", id, {});
}

/**
 * CSV (;) του πελατολογίου, ανοίγει σωστά στο Excel.
 *  - "all": όλοι οι πελάτες με τα στατιστικά τους (εσωτερική χρήση)
 *  - "marketing": ΜΟΝΟ όσοι έχουν δώσει συγκατάθεση για ενημερώσεις (για newsletter/SMS)
 */
export async function customersCsv(mode: "all" | "marketing", employeeId: number): Promise<{ csv: string; count: number }> {
  const all = await listCustomers();
  const rows = mode === "marketing" ? all.filter((c) => c.marketingConsent) : all;
  // Κελιά που ξεκινούν με = + - @ θα εκτελούνταν ως τύποι στο Excel (τα ονόματα μπορεί να έρχονται από το site).
  const q = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  const table: string[][] =
    mode === "marketing"
      ? [["Όνομα", "Τηλέφωνο", "Email", "Συγκατάθεση από"], ...rows.map((c) => [c.name, c.phone, c.email ?? "", day(c.consentAt)])]
      : [
          ["Όνομα", "Τηλέφωνο", "Email", "Κρατήσεις", "Τελευταία κράτηση", "Αξία κρατήσεων", "Συγκατάθεση ενημερώσεων", "Σημειώσεις"],
          ...rows.map((c) => [c.name, c.phone, c.email ?? "", String(c.bookings), c.lastBookingDate ?? "", money(c.totalBookedCents), c.marketingConsent ? "ΝΑΙ" : "ΟΧΙ", c.notes ?? ""]),
        ];
  const db = await getDb();
  await audit(db, employeeId, "customers_export", "customer", null, { mode, count: rows.length });
  return { csv: "﻿" + table.map((r) => r.map(q).join(";")).join("\r\n"), count: rows.length };
}
