/**
 * Βοηθητικά ημερομηνιών για το ημερολόγιο εκδηλώσεων.
 * Καθαρές συναρτήσεις πάνω σε ISO strings ("YYYY-MM-DD" / "YYYY-MM"), χωρίς ζώνη ώρας — ίδιες σε server και browser.
 */

export const MONTH_NAMES = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];
export const MONTH_NAMES_GEN = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];
/** Εβδομάδα που ξεκινά Δευτέρα. */
export const WEEKDAYS_SHORT = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];
export const WEEKDAYS_LONG = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function toDate(iso: string): Date {
  return new Date(iso + "T12:00:00Z");
}
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** 0 = Δευτέρα … 6 = Κυριακή. */
export function weekdayMon(iso: string): number {
  return (toDate(iso).getUTCDay() + 6) % 7;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" -> "Σεπτέμβριος 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
}

/** "2026-09-29" -> "Τρίτη 29 Σεπτεμβρίου 2026" */
export function longDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${WEEKDAYS_LONG[weekdayMon(iso)]} ${d} ${MONTH_NAMES_GEN[m - 1]} ${y}`;
}

export type MonthGrid = {
  month: string;
  /** Πρώτη/τελευταία ημέρα του πλέγματος (περιλαμβάνει ημέρες γειτονικών μηνών). */
  from: string;
  to: string;
  /** Εβδομάδες × 7 ημέρες ως ISO ημερομηνίες. */
  weeks: string[][];
};

/** Πλέγμα μήνα με εβδομάδες Δευτέρα–Κυριακή, συμπληρωμένο με ημέρες των γειτονικών μηνών. */
export function monthGrid(month: string): MonthGrid {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = addDaysIso(first, -weekdayMon(first));
  const rows = Math.ceil((weekdayMon(first) + daysInMonth) / 7);
  const weeks: string[][] = [];
  let cursor = from;
  for (let r = 0; r < rows; r++) {
    const week: string[] = [];
    for (let c = 0; c < 7; c++) {
      week.push(cursor);
      cursor = addDaysIso(cursor, 1);
    }
    weeks.push(week);
  }
  return { month, from, to: addDaysIso(cursor, -1), weeks };
}
