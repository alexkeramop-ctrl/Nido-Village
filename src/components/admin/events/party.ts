/**
 * Τιμοκατάλογος παιδικών πάρτι (από τον επίσημο τιμοκατάλογο Nido Village) και υπολογισμός τιμής.
 * Τιμές σε λεπτά, με ΦΠΑ. Αν αλλάξει ο τιμοκατάλογος, αλλάζει μόνο αυτό το αρχείο.
 */
import type { PartyDetails } from "@/db/schema";

export const PARTY_PACKAGES = [
  { key: "little_nest", name: "Little Nest · 2–5 ετών", perChildCents: 1000, note: "Παιδική χαρά, αμμοδόχος, πινιάτα + μενού Nido Mini" },
  { key: "bounce", name: "Bounce Party", perChildCents: 1500, note: "Φουσκωτό πάρκο 60′ + παιδική χαρά + μενού Nido Classic" },
  { key: "bungee", name: "Bungee Party", perChildCents: 1600, note: "Φουσκωτό πάρκο 60′ + 1 γύρος bungee + μενού Nido Classic" },
  { key: "jump", name: "Jump Party", perChildCents: 1600, note: "Φουσκωτό πάρκο 60′ + τραμπολίνο 20′ + μενού Nido Classic" },
  { key: "adventure", name: "NIDO Adventure", perChildCents: 1900, note: "Φουσκωτό, αναρρίχηση, τραμπολίνο, bungee + μενού Nido Burger" },
] as const;

export const ADULT_MENUS = [
  { key: "none", name: "Χωρίς μενού ενηλίκων", perAdultCents: 0 },
  { key: "classic", name: "Πιατέλα Classic (€5/άτομο)", perAdultCents: 500 },
  { key: "grill", name: "Πιατέλα Grill (€9/άτομο)", perAdultCents: 900 },
  { key: "buffet", name: "Nido Buffet (€16/άτομο, από 25)", perAdultCents: 1600 },
] as const;

export const PARTY_EXTRAS = [
  { key: "inflatable", name: "Φουσκωτό μόνο για το πάρτι (60′)", cents: 8000 },
  { key: "pitch", name: "Γήπεδο 5x5 αποκλειστικά (60′)", cents: 3000 },
  { key: "pinata", name: "Πινιάτα από εμάς", cents: 2500 },
  { key: "balloons", name: "Στολισμός τραπεζιού με μπαλόνια", cents: 4000 },
  { key: "extra_hour", name: "Επιπλέον ώρα πάρτι", cents: 5000 },
] as const;

/** Διάρκεια πάρτι: 2,5 ώρες. */
export const PARTY_MINUTES = 150;
/** Έκπτωση Δευτέρα–Πέμπτη (εκτός αργιών): −€1 ανά παιδί. */
export const WEEKDAY_DISCOUNT_CENTS = 100;

export function packageByKey(key?: string) {
  return PARTY_PACKAGES.find((p) => p.key === key);
}

/** Δευτέρα–Πέμπτη; (ISO ημερομηνία YYYY-MM-DD) */
export function isMonToThu(iso: string): boolean {
  const d = new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = Κυριακή
  return d >= 1 && d <= 4;
}

export type PartyQuote = { lines: { label: string; cents: number }[]; totalCents: number };

/** Πρόταση τιμής από πακέτο, παιδιά, ενήλικες και έξτρα. Οι αργίες δεν αναγνωρίζονται αυτόματα. */
export function quoteParty(p: PartyDetails, date: string): PartyQuote {
  const lines: PartyQuote["lines"] = [];
  const pkg = packageByKey(p.package);
  const kids = Math.max(0, p.kids ?? 0);
  const adults = Math.max(0, p.adults ?? 0);
  if (pkg && kids) {
    lines.push({ label: `${pkg.name} × ${kids} παιδιά`, cents: pkg.perChildCents * kids });
    if (isMonToThu(date)) lines.push({ label: `Δευτέρα–Πέμπτη −€1 × ${kids}`, cents: -WEEKDAY_DISCOUNT_CENTS * kids });
  }
  const menu = ADULT_MENUS.find((m) => m.key === p.adultMenu);
  if (menu && menu.perAdultCents && adults) lines.push({ label: `${menu.name.split(" (")[0]} × ${adults} ενήλικες`, cents: menu.perAdultCents * adults });
  for (const key of p.extras ?? []) {
    const x = PARTY_EXTRAS.find((e) => e.key === key);
    if (x) lines.push({ label: x.name, cents: x.cents });
  }
  return { lines, totalCents: lines.reduce((a, l) => a + l.cents, 0) };
}

/** Πρόσθεση λεπτών σε ώρα HH:MM (κόβεται στο 23:59). */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
