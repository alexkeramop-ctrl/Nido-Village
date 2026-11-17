/**
 * Τηλέφωνα πελατών: κανονικοποίηση και σύνδεσμοι (tel:, WhatsApp).
 * Καθαρές συναρτήσεις, ίδιες σε server και browser.
 *
 * Κανονική μορφή:
 *  - ελληνικός αριθμός: 10 ψηφία χωρίς κενά/παύλες/+30 (π.χ. "6912345678", "2310123456")
 *  - αριθμός εξωτερικού: "00" + κωδικός χώρας + αριθμός (π.χ. "004915112345678")
 */

/** "+30 691 234-5678" -> "6912345678". Επιστρέφει "" αν δεν υπάρχουν ψηφία. */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const t = String(raw).trim();
  const plus = t.startsWith("+");
  let d = t.replace(/\D/g, "");
  if (!d) return "";
  if (plus) d = "00" + d;
  if (d.startsWith("0030")) d = d.slice(4);
  // "30 691…" γραμμένο χωρίς + (12 ψηφία που ξεκινούν με 30 και συνεχίζουν με ελληνικό αριθμό).
  else if (d.length === 12 && /^30[26]/.test(d)) d = d.slice(2);
  return d;
}

/** Ελληνικό κινητό/σταθερό (10 ψηφία) ή αριθμός εξωτερικού σε κανονική μορφή. */
export function isValidPhone(normalized: string): boolean {
  return /^(?:69\d{8}|2\d{9}|00[1-9]\d{7,13})$/.test(normalized);
}

export function isGreekMobile(normalized: string): boolean {
  return /^69\d{8}$/.test(normalized);
}

/** Εμφάνιση: "691 234 5678" για ελληνικούς αριθμούς, αλλιώς "+49…". */
export function formatPhone(raw: string | null | undefined): string {
  const p = normalizePhone(raw);
  if (!p) return (raw ?? "").trim();
  if (/^\d{10}$/.test(p) && !p.startsWith("00")) return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
  if (p.startsWith("00")) return `+${p.slice(2)}`;
  return p;
}

/** Διεθνής μορφή χωρίς + (για wa.me): "306912345678". null αν ο αριθμός δεν είναι έγκυρος. */
export function internationalDigits(raw: string | null | undefined): string | null {
  const p = normalizePhone(raw);
  if (!isValidPhone(p)) return null;
  return p.startsWith("00") ? p.slice(2) : `30${p}`;
}

export function telHref(raw: string | null | undefined): string | null {
  const intl = internationalDigits(raw);
  return intl ? `tel:+${intl}` : null;
}

/** Σύνδεσμος WhatsApp με έτοιμο μήνυμα. Μόνο για κινητά (τα ελληνικά σταθερά δεν έχουν WhatsApp). */
export function whatsappHref(raw: string | null | undefined, text?: string): string | null {
  const p = normalizePhone(raw);
  if (!isValidPhone(p)) return null;
  if (!p.startsWith("00") && !isGreekMobile(p)) return null;
  const intl = p.startsWith("00") ? p.slice(2) : `30${p}`;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
