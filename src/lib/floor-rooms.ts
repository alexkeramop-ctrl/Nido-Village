/**
 * Δωμάτια (χώροι) με τραπέζια σε πλέγμα: καθαρές συναρτήσεις, κοινές για server και tests.
 * Οι θέσεις είναι σε χιλιοστά (0–1000) του πλάτους/ύψους της κάτοψης.
 */

export const MAX_ROOM_TABLES = 60;
export const MAX_ROOM_COLS = 10;
export const DEFAULT_ROOM_TABLES = 20;
export const DEFAULT_ROOM_COLS = 5;

/** Το έτοιμο ξεκίνημα: τρία ξεχωριστά δωμάτια με 20 τραπέζια το καθένα (4 σειρές × 5). */
export const ROOM_PRESET = [
  { name: "Παιδική", prefix: "Π" },
  { name: "Σαλόνι", prefix: "Σ" },
  { name: "Μπαλκόνι", prefix: "Μ" },
] as const;

/** Θέσεις πλέγματος για `count` τραπέζια σε `cols` στήλες, γεμίζοντας σειρά-σειρά. */
export function gridPositions(count: number, cols: number): { posX: number; posY: number }[] {
  const c = Math.max(1, Math.min(MAX_ROOM_COLS, Math.round(cols)));
  const rows = Math.max(1, Math.ceil(count / c));
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    posX: Math.round(((i % c) + 0.5) * (1000 / c)),
    posY: Math.round((Math.floor(i / c) + 0.5) * (1000 / rows)),
  }));
}

/** Προεπιλεγμένο πρόθεμα τραπεζιών από το όνομα του δωματίου (πρώτο γράμμα, κεφαλαίο). */
export function defaultPrefix(roomName: string): string {
  const ch = roomName.trim().charAt(0);
  return ch ? ch.toLocaleUpperCase("el") : "Τ";
}

/** Χωρίζει όνομα τραπεζιού σε πρόθεμα και αριθμό, π.χ. "Π12" -> { prefix: "Π", n: 12 }. */
export function splitTableName(name: string): { prefix: string; n: number } | null {
  const m = /^(.*?)(\d+)$/.exec(name.trim());
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}

/** Όνομα για το επόμενο τραπέζι ενός δωματίου: ίδιο πρόθεμα με τα υπάρχοντα, επόμενος αριθμός. */
export function nextTableName(existing: string[], roomName: string, taken: Set<string> = new Set()): string {
  const counts = new Map<string, { n: number; max: number }>();
  for (const name of existing) {
    const s = splitTableName(name);
    if (!s) continue;
    const cur = counts.get(s.prefix) ?? { n: 0, max: 0 };
    counts.set(s.prefix, { n: cur.n + 1, max: Math.max(cur.max, s.n) });
  }
  let prefix = defaultPrefix(roomName);
  let max = 0;
  let best = 0;
  for (const [p, v] of counts) {
    if (v.n > best) {
      best = v.n;
      prefix = p;
      max = v.max;
    }
  }
  const all = new Set([...existing, ...taken]);
  let n = max + 1;
  while (all.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Ελεύθερο σημείο για νέο τραπέζι: το πρώτο κελί πλέγματος που δεν πέφτει πάνω σε άλλο τραπέζι. */
export function freeSpot(placed: { posX: number; posY: number }[], cols = DEFAULT_ROOM_COLS): { posX: number; posY: number } {
  const rows = Math.max(4, Math.ceil((placed.length + 1) / cols));
  const minGap = Math.min(1000 / cols, 1000 / rows) * 0.6;
  for (const cell of gridPositions(rows * cols, cols)) {
    if (placed.every((p) => Math.hypot(p.posX - cell.posX, p.posY - cell.posY) >= minGap)) return cell;
  }
  return { posX: 500, posY: 500 };
}
