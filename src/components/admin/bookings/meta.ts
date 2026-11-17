/**
 * Πληρωμές κρατήσεων, οφειλές, πελατολόγιο, γενέθλια: τύποι, ετικέτες και καθαροί υπολογισμοί
 * (κοινά για server και client, χωρίς πρόσβαση σε βάση).
 */
import type { EventStatus, EventType } from "@/db/schema";
import { formatEuro } from "@/server/money";

/* ------------------------------ Πληρωμές ------------------------------ */

export type BookingPaymentType = "deposit" | "settlement";
export type BookingPaymentMethod = "cash" | "card" | "bank";

/** Οι κατηγορίες εσόδων του «Έσοδα – Έξοδα» στις οποίες γράφονται οι πληρωμές κρατήσεων. */
export const PAYMENT_CATEGORY: Record<BookingPaymentType, string> = {
  deposit: "Προκαταβολή εκδήλωσης",
  settlement: "Εξόφληση εκδήλωσης",
};
export const PAYMENT_TYPE_LABEL: Record<BookingPaymentType, string> = { deposit: "Προκαταβολή", settlement: "Εξόφληση" };
export const PAYMENT_METHOD_LABEL: Record<BookingPaymentMethod, string> = { cash: "Μετρητά", card: "Κάρτα", bank: "Τράπεζα" };
export const PAYMENT_TYPES: BookingPaymentType[] = ["deposit", "settlement"];
export const PAYMENT_METHODS: BookingPaymentMethod[] = ["cash", "card", "bank"];

export function paymentTypeOfCategory(category: string): BookingPaymentType {
  return category === PAYMENT_CATEGORY.deposit ? "deposit" : "settlement";
}

/** Μία πληρωμή κράτησης (= κίνηση εσόδου με eventId). */
export type BookingPayment = {
  id: number;
  date: string;
  amountCents: number;
  method: string;
  type: BookingPaymentType;
  note: string;
};

/**
 * Κατάσταση πληρωμής μιας κράτησης.
 *  - paid: εξοφλημένη · partial: έχει μπει ποσό, μένει υπόλοιπο · unpaid: τίποτα ακόμη
 *  - free: δεν έχει οριστεί τιμή (π.χ. ραντεβού), δεν υπολογίζεται υπόλοιπο
 */
export type PayState = "paid" | "partial" | "unpaid" | "free";

export type PaySummary = {
  priceCents: number;
  /** Σύνολο εισπράξεων (πληρωμές + τυχόν παλιά σημειωμένη προκαταβολή). */
  paidCents: number;
  /** Υπόλοιπο· 0 όταν δεν έχει οριστεί τιμή. */
  balanceCents: number;
  /** Παλιά σημείωση «πληρώθηκε η προκαταβολή» χωρίς αντίστοιχη κίνηση εσόδου (μόνο παλιές εγγραφές). */
  legacyDepositCents: number;
  state: PayState;
};

/**
 * Σύνολα πληρωμών μιας κράτησης. Τα ποσά έρχονται από τις κινήσεις εσόδων της κράτησης.
 * Παλιές εγγραφές με τσεκαρισμένο «πληρώθηκε η προκαταβολή»: η προκαταβολή μετράει ως εισπραγμένη
 * μέχρι να καταχωρηθεί πληρωμή τύπου «προκαταβολή» (τότε ισχύουν μόνο οι πληρωμές).
 */
export function summarizePayments(
  event: { priceCents: number; depositCents: number; depositPaid: boolean },
  totals: { depositCents: number; settlementCents: number } | undefined,
): PaySummary {
  const deposit = totals?.depositCents ?? 0;
  const settlement = totals?.settlementCents ?? 0;
  const legacyDepositCents = event.depositPaid && event.depositCents > 0 && deposit === 0 ? event.depositCents : 0;
  const paidCents = deposit + settlement + legacyDepositCents;
  const priceCents = Math.max(0, event.priceCents);
  const balanceCents = priceCents > 0 ? Math.max(0, priceCents - paidCents) : 0;
  const state: PayState = priceCents <= 0 ? "free" : paidCents >= priceCents ? "paid" : paidCents > 0 ? "partial" : "unpaid";
  return { priceCents, paidCents, balanceCents, legacyDepositCents, state };
}

export type PayBadge = { label: string; short: string; tone: "ok" | "warn" | "danger" | "neutral" };

/** Ποσό χωρίς δεκαδικά όταν είναι στρογγυλό ("200 €"), για τα μικρά chips του ημερολογίου. */
export function euroShort(cents: number): string {
  return cents % 100 === 0 ? `${(cents / 100).toLocaleString("el-GR")} €` : formatEuro(cents);
}

/**
 * Ετικέτα πληρωμής για chips/λίστες: «Εξοφλημένο», «Προκαταβολή ✓ · υπόλοιπο X €», «Χωρίς προκαταβολή».
 * null όταν δεν έχει νόημα (αίτημα χωρίς πληρωμές, ραντεβού χωρίς τιμή, ακυρωμένο χωρίς εισπράξεις).
 */
export function payBadge(status: EventStatus, pay: PaySummary): PayBadge | null {
  if (status === "cancelled") {
    return pay.paidCents > 0 ? { label: `Ακυρώθηκε · εισπράχθηκαν ${formatEuro(pay.paidCents)}`, short: `Εισπρ. ${euroShort(pay.paidCents)}`, tone: "warn" } : null;
  }
  if (pay.state === "free") {
    return pay.paidCents > 0 ? { label: `Εισπράχθηκαν ${formatEuro(pay.paidCents)} (χωρίς τιμή)`, short: `Εισπρ. ${euroShort(pay.paidCents)}`, tone: "neutral" } : null;
  }
  if (pay.state === "paid") return { label: "Εξοφλημένο", short: "Εξοφλημένο", tone: "ok" };
  if (pay.state === "partial") {
    return { label: `Προκαταβολή ✓ · υπόλοιπο ${formatEuro(pay.balanceCents)}`, short: `Προκ. ✓ · υπόλ. ${euroShort(pay.balanceCents)}`, tone: "warn" };
  }
  if (status === "confirmed") return { label: "Χωρίς προκαταβολή", short: "Χωρίς προκαταβολή", tone: "danger" };
  if (status === "done") return { label: `Ανεξόφλητο · υπόλοιπο ${formatEuro(pay.balanceCents)}`, short: `Ανεξόφλ. ${euroShort(pay.balanceCents)}`, tone: "danger" };
  return null;
}

/** Η περιγραφή της κίνησης εσόδου: τίτλος και ημερομηνία της κράτησης, μετά η σημείωση. */
export function paymentDescription(event: { title: string; date: string }, note?: string | null): string {
  const [y, m, d] = event.date.split("-");
  const head = `Κράτηση: ${event.title.trim().slice(0, 120)} (${d}/${m}/${y})`;
  const n = (note ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  return n ? `${head} · ${n}` : head;
}

/** Η σημείωση μέσα από την περιγραφή της κίνησης (ό,τι ακολουθεί το «Κράτηση: … (ηη/μμ/εεεε) · »). */
export function paymentNote(description: string): string {
  const m = /^Κράτηση: .*? \(\d{2}\/\d{2}\/\d{4}\)(?: · ([\s\S]*))?$/.exec(description);
  if (m) return m[1] ?? "";
  return description;
}

/* ------------------------------- Οφειλές ------------------------------- */

export type DueRow = {
  id: number;
  title: string;
  type: EventType;
  status: EventStatus;
  date: string;
  startTime: string;
  customerName: string;
  customerPhone: string | null;
  pay: PaySummary;
  /** Ημέρες μέχρι την εκδήλωση (αρνητικό = έχει περάσει). */
  daysUntil: number;
};

function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Ευγενική υπενθύμιση υπολοίπου για WhatsApp. */
export function dueReminderText(row: { typeLabel: string; date: string; balanceCents: number }, venue = "Nido Village"): string {
  return (
    `Γεια σας! Εδώ το ${venue} 🌿 ` +
    `Σας υπενθυμίζουμε ευγενικά ότι για την κράτησή σας (${row.typeLabel}, ${dmy(row.date)}) υπάρχει υπόλοιπο ${formatEuro(row.balanceCents)}. ` +
    `Μπορείτε να το τακτοποιήσετε με μετρητά, κάρτα ή τραπεζική κατάθεση, όποτε σας εξυπηρετεί. ` +
    `Για οποιαδήποτε απορία είμαστε στη διάθεσή σας. Ευχαριστούμε πολύ!`
  );
}

/* ----------------------------- Πελατολόγιο ----------------------------- */

export type CustomerRow = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  marketingConsent: boolean;
  consentAt: string | null;
  createdAt: string;
  /** Κρατήσεις που δεν έχουν ακυρωθεί. */
  bookings: number;
  lastBookingDate: string | null;
  totalBookedCents: number;
};

/** Ο πελάτης που προτείνεται στη φόρμα κράτησης όταν πληκτρολογείται γνωστό τηλέφωνο. */
export type CustomerMatch = { id: number; name: string; phone: string; email: string | null; bookings: number; marketingConsent: boolean };

/* ------------------------------ Γενέθλια ------------------------------ */

export type BirthdayRow = {
  /** Η τελευταία κράτηση πάρτι του παιδιού. */
  eventId: number;
  childName: string;
  /** Πόσων ετών γίνεται φέτος (ηλικία στο τελευταίο πάρτι + χρόνια που πέρασαν)· null αν δεν είχε δοθεί ηλικία. */
  turningAge: number | null;
  lastPartyDate: string;
  /** Η επέτειος του πάρτι που πλησιάζει. */
  anniversary: string;
  daysUntil: number;
  parentName: string;
  phone: string | null;
  /** Υπάρχει συγκατάθεση για ενημερώσεις· χωρίς αυτήν δεν δείχνουμε συνδέσμους επικοινωνίας. */
  consent: boolean;
};

/**
 * Φιλικό μήνυμα για τα γενέθλια που πλησιάζουν (WhatsApp).
 * Το όνομα μπαίνει σε παρένθεση, χωρίς άρθρο/πτώση, ώστε να είναι σωστό για κάθε όνομα.
 */
export function birthdayText(row: { childName: string; turningAge: number | null }, venue = "Nido Village"): string {
  const child = row.childName.trim();
  const who = row.turningAge ? `${child}, γίνεται ${row.turningAge}` : child;
  return (
    `Γεια σας! Εδώ το ${venue} 🌿 Πλησιάζουν ξανά τα γενέθλια 🎂 (${who}). ` +
    `Θα χαρούμε πολύ να τα γιορτάσουμε και φέτος μαζί! ` +
    `Αν θέλετε, πείτε μας ποια ημέρα σας βολεύει για να σας κρατήσουμε τον χώρο. 🎈`
  );
}

/**
 * Η επόμενη επέτειος μιας ημερομηνίας από τη «σήμερα» και μετά (29/2 → 28/2 στα μη δίσεκτα).
 * Επιστρέφει ISO ημερομηνία.
 */
export function nextAnniversary(iso: string, today: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const year = Number(today.slice(0, 4));
  const at = (y: number) => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  };
  const thisYear = at(year);
  return thisYear >= today ? thisYear : at(year + 1);
}

/** Ημέρες από a έως b (ISO ημερομηνίες). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}
