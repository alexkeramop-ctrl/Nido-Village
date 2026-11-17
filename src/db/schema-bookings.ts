/**
 * Κρατήσεις: πελατολόγιο και όριο αιτημάτων από το site.
 * Το αρχείο δεν εισάγει τίποτα από το ./schema (το ./schema εισάγει από εδώ για το events.customerId).
 */
import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

const ts = () => timestamp({ withTimezone: true, mode: "date" });

/**
 * Πελάτες κρατήσεων. Το τηλέφωνο είναι κανονικοποιημένο (χωρίς κενά/παύλες/+30, βλ. src/lib/phone.ts) και μοναδικό.
 * marketingConsent: ρητή συγκατάθεση για ενημερώσεις (GDPR)· χωρίς αυτήν δεν στέλνουμε υπενθυμίσεις γενεθλίων.
 */
export const customers = pgTable("customers", {
  id: serial().primaryKey(),
  name: text().notNull().default(""),
  phone: text().notNull().unique(),
  email: text(),
  notes: text(),
  marketingConsent: boolean().notNull().default(false),
  consentAt: ts(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

/** Ένα row ανά αίτημα κράτησης από το site (hash της IP), για όριο 5 ανά ώρα. Τα παλιά σβήνονται αυτόματα. */
export const bookingRequestHits = pgTable(
  "booking_request_hits",
  {
    id: serial().primaryKey(),
    ipHash: text().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index("booking_request_hits_ip_idx").on(t.ipHash, t.createdAt)],
);
