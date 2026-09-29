/** Μορφοποίηση ημερομηνιών/ποσοτήτων για το back-office. Ντετερμινιστική (ίδια σε server και browser). */
const TZ = "Europe/Athens";

function parts(d: Date, opts: Intl.DateTimeFormatOptions) {
  const list = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", ...opts }).formatToParts(d);
  return (t: Intl.DateTimeFormatPartTypes) => list.find((p) => p.type === t)?.value ?? "";
}

/** ISO string ή Date -> "29/09/2026 14:05" (ώρα Αθήνας). */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  const g = parts(d, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

/** ISO string ή Date -> "29/09/2026". */
export function fmtDateOnly(value: string | Date | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  const g = parts(d, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${g("day")}/${g("month")}/${g("year")}`;
}

/** "2026-09-29" -> "29/09/2026" χωρίς μετατροπή ζώνης ώρας. */
export function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

const DAY_NAMES = ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"];

/** "2026-09-29" -> "Τρί 29/9". */
export function fmtDayShort(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Ποσότητα με έως 3 δεκαδικά και ελληνική υποδιαστολή. */
export function fmtQty(n: number, signed = false): string {
  const r = Math.round(n * 1000) / 1000;
  const s = String(Math.abs(r)).replace(".", ",");
  if (r < 0) return `-${s}`;
  return signed && r > 0 ? `+${s}` : s;
}

/** Λεπτά -> "12,50" (για inputs τιμής, χωρίς σύμβολο). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Ευρώ (float) -> "0,0085" για inputs κόστους. */
export function euroToInput(euro: number, decimals = 4): string {
  const s = euro.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
  return (s || "0").replace(".", ",");
}

/** "0,0085" -> 0.0085 */
export function parseDecimal(input: string, fallback = 0): number {
  const n = Number(String(input).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}
