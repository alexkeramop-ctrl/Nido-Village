/**
 * Πληρωμή μιας πώλησης: μετρητά, κάρτα ή μοιρασμένη. Καθαρές συναρτήσεις, κοινές σε ταμείο (client) και server,
 * ώστε τα ρέστα που βλέπει ο ταμίας να είναι ακριβώς αυτά που γράφονται.
 * Όλα τα ποσά είναι ακέραια λεπτά.
 */
export type TenderMethod = "cash" | "card" | "other";

export type TenderInput = {
  /** Το μέρος του συνόλου που πληρώνεται με μετρητά. */
  cashCents: number;
  /** Το μέρος που πληρώνεται με κάρτα. */
  cardCents: number;
  otherCents?: number;
  /** Τα μετρητά που έδωσε ο πελάτης (≥ cashCents). Αν λείπει: ακριβώς το ποσό. */
  tenderedCashCents?: number | null;
};

export type TenderPayment = { method: TenderMethod; amountCents: number; tenderedCents: number; changeCents: number };
export type TenderPlan = { payments: TenderPayment[]; changeCents: number };

const isCents = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Ελέγχει ότι τα μέρη αθροίζουν ακριβώς στο σύνολο και υπολογίζει τα ρέστα. Πετάει Error με ελληνικό μήνυμα. */
export function planTender(totalCents: number, t: TenderInput): TenderPlan {
  if (!isCents(totalCents)) throw new Error("Μη έγκυρο σύνολο");
  const cash = t.cashCents ?? 0;
  const card = t.cardCents ?? 0;
  const other = t.otherCents ?? 0;
  if (!isCents(cash) || !isCents(card) || !isCents(other)) throw new Error("Μη έγκυρο ποσό πληρωμής");
  if (cash + card + other !== totalCents) throw new Error("Τα ποσά της πληρωμής δεν συμφωνούν με το σύνολο");
  const tendered = t.tenderedCashCents ?? cash;
  if (!isCents(tendered)) throw new Error("Μη έγκυρο ποσό μετρητών");
  if (tendered < cash) throw new Error("Τα μετρητά είναι λιγότερα από το ποσό");
  if (cash === 0 && tendered > 0) throw new Error("Δόθηκαν μετρητά χωρίς ποσό μετρητών");
  const change = tendered - cash;
  const payments: TenderPayment[] = [];
  if (card > 0) payments.push({ method: "card", amountCents: card, tenderedCents: card, changeCents: 0 });
  if (cash > 0) payments.push({ method: "cash", amountCents: cash, tenderedCents: tendered, changeCents: change });
  if (other > 0) payments.push({ method: "other", amountCents: other, tenderedCents: other, changeCents: 0 });
  return { payments, changeCents: change };
}

/**
 * Γρήγορα ποσά για μετρητά: ακριβώς, και μετά το επόμενο πολλαπλάσιο των 5, 10, 20 και 50 €
 * (π.χ. για 12,50 €: 12,50 · 15 · 20 · 50). Πάντα ≥ του ποσού, χωρίς διπλά, αύξουσα σειρά.
 */
export function quickAmounts(amountCents: number): number[] {
  if (!isCents(amountCents) || amountCents === 0) return [];
  const out = new Set<number>([amountCents]);
  for (const step of [500, 1000, 2000, 5000]) {
    const up = Math.ceil(amountCents / step) * step;
    out.add(up === amountCents ? amountCents + step : up);
  }
  return [...out].sort((a, b) => a - b);
}
