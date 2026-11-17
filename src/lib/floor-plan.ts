/**
 * Κάτοψη χώρου: δωμάτια ως ορθογώνια σε χιλιοστά (0–1000) του καμβά, όπως και οι θέσεις των τραπεζιών.
 * Καθαρές συναρτήσεις, κοινές για server (έλεγχος/καθαρισμός) και client (σχεδίαση).
 */

/**
 * Στοιχείο του σχεδίου: γενική ζώνη ή έτοιμο στοιχείο χώρου (μπαρ, τζάκι, κουζίνα…) που σχεδιάζεται με το εικονίδιό του.
 * Το `kind` λείπει στις γενικές ζώνες (και σε ό,τι αποθηκεύτηκε πριν υπάρξουν τα στοιχεία).
 */
export type PlanRoom = { id: string; name: string; x: number; y: number; w: number; h: number; color?: string; kind?: FixtureKind };
export type FloorPlan = { rooms: PlanRoom[] };

/** Λόγος πλευρών του καμβά της κάτοψης (πλάτος / ύψος) όταν δεν υπάρχει φωτογραφία. */
export const PLAN_ASPECT = { w: 4, h: 3 } as const;
export const MAX_ROOMS = 30;
/** Ελάχιστη πλευρά δωματίου: αρκετά μεγάλη ώστε να πιάνεται και να σύρεται με το δάχτυλο σε κινητό. */
export const MIN_ROOM_SIZE = 100;
export const MAX_ROOM_NAME = 40;
export const DEFAULT_ROOM_NAME = "Ζώνη";

/** Έτοιμα στοιχεία χώρου: αποθηκεύεται μόνο το κλειδί. Μέγεθος σε χιλιοστά του καμβά. */
export const FIXTURES = [
  { key: "bar", label: "Μπαρ", icon: "🍸", w: 420, h: 120, color: "sand" },
  { key: "kitchen", label: "Κουζίνα", icon: "🍳", w: 300, h: 200, color: "stone" },
  { key: "fireplace", label: "Τζάκι", icon: "🔥", w: 150, h: 110, color: "rose" },
  { key: "entrance", label: "Είσοδος", icon: "🚪", w: 170, h: 100, color: "sage" },
  { key: "till", label: "Ταμείο", icon: "💶", w: 190, h: 110, color: "sand" },
  { key: "buffet", label: "Μπουφές", icon: "🍽️", w: 360, h: 110, color: "lavender" },
  { key: "stage", label: "Πίστα / Σκηνή", icon: "🎵", w: 300, h: 220, color: "lavender" },
  { key: "play", label: "Παιχνίδια", icon: "🎈", w: 300, h: 240, color: "sky" },
  { key: "wc", label: "WC", icon: "🚻", w: 160, h: 140, color: "sky" },
] as const;
export type FixtureKind = (typeof FIXTURES)[number]["key"];

export function fixtureOf(kind: string | undefined) {
  return FIXTURES.find((f) => f.key === kind) ?? null;
}

/** Σταθερή παλέτα: αποθηκεύεται το κλειδί, όχι ελεύθερο CSS. */
export const ROOM_COLORS = [
  { key: "sand", label: "Άμμος", fill: "#f3e8d0", stroke: "#b08a3e" },
  { key: "sage", label: "Πράσινο", fill: "#dfe9d6", stroke: "#5f7f52" },
  { key: "sky", label: "Γαλάζιο", fill: "#dbe9f6", stroke: "#4f7fb0" },
  { key: "rose", label: "Ροζ", fill: "#f8dfe0", stroke: "#b8686e" },
  { key: "lavender", label: "Λεβάντα", fill: "#e6e0f5", stroke: "#7a68b0" },
  { key: "stone", label: "Γκρι", fill: "#e9e8e3", stroke: "#85857c" },
] as const;
export type RoomColorKey = (typeof ROOM_COLORS)[number]["key"];
export const DEFAULT_ROOM_COLOR: RoomColorKey = "sand";

export function roomColor(key: string | undefined) {
  return ROOM_COLORS.find((c) => c.key === key) ?? ROOM_COLORS[0];
}

const int = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const between = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Περιορίζει ένα ορθογώνιο μέσα στον καμβά, με ελάχιστο μέγεθος. */
export function clampRoomRect(r: { x: number; y: number; w: number; h: number }) {
  const w = between(Math.round(r.w), MIN_ROOM_SIZE, 1000);
  const h = between(Math.round(r.h), MIN_ROOM_SIZE, 1000);
  return { x: between(Math.round(r.x), 0, 1000 - w), y: between(Math.round(r.y), 0, 1000 - h), w, h };
}

export function newRoomId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Καθαρίζει ό,τι έρχεται από τον client ή τη βάση: έως MAX_ROOMS δωμάτια, συντεταγμένες μέσα στον καμβά,
 * ελάχιστο μέγεθος, όνομα έως MAX_ROOM_NAME χαρακτήρες, χρώμα μόνο από την παλέτα, μοναδικά id.
 * Πετά σφάλμα για εντελώς άκυρη μορφή ή υπερβολικό πλήθος· δωμάτια χωρίς αριθμητικές διαστάσεις παραλείπονται.
 */
export function sanitizePlan(input: unknown): FloorPlan {
  if (input === null || input === undefined) return { rooms: [] };
  if (typeof input !== "object") throw new Error("Μη έγκυρη κάτοψη");
  const raw = (input as { rooms?: unknown }).rooms;
  if (raw === undefined || raw === null) return { rooms: [] };
  if (!Array.isArray(raw)) throw new Error("Μη έγκυρη κάτοψη");
  if (raw.length > MAX_ROOMS) throw new Error(`Έως ${MAX_ROOMS} δωμάτια ανά χώρο`);
  const seen = new Set<string>();
  const rooms: PlanRoom[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const x = int(r.x);
    const y = int(r.y);
    const w = int(r.w);
    const h = int(r.h);
    if (x === null || y === null || w === null || h === null) continue;
    let id = typeof r.id === "string" ? r.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) : "";
    while (!id || seen.has(id)) id = newRoomId();
    seen.add(id);
    const name =
      (typeof r.name === "string" ? r.name : "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_ROOM_NAME) || DEFAULT_ROOM_NAME;
    const color = roomColor(typeof r.color === "string" ? r.color : undefined).key;
    const kind = fixtureOf(typeof r.kind === "string" ? r.kind : undefined)?.key;
    rooms.push({ id, name, ...clampRoomRect({ x, y, w, h }), color, ...(kind ? { kind } : {}) });
  }
  return { rooms };
}

/** Έτοιμη αρχή με 3 δωμάτια, για να τα μετονομάσει/αλλάξει μέγεθος ο υπεύθυνος. */
export function presetThreeRooms(): PlanRoom[] {
  return [
    { id: newRoomId(), name: "Σάλα", x: 40, y: 50, w: 520, h: 520, color: "sand" },
    { id: newRoomId(), name: "Βεράντα", x: 600, y: 50, w: 360, h: 520, color: "sky" },
    { id: newRoomId(), name: "Κήπος", x: 40, y: 620, w: 920, h: 330, color: "sage" },
  ];
}

/** Θέση για νέο δωμάτιο: κλιμακωτά, ώστε να μην πέφτει ακριβώς πάνω στο προηγούμενο. */
export function nextRoom(existing: PlanRoom[]): PlanRoom {
  const n = existing.length;
  const used = new Set(existing.map((r) => r.color));
  const color = ROOM_COLORS.find((c) => !used.has(c.key))?.key ?? ROOM_COLORS[n % ROOM_COLORS.length].key;
  const off = (n % 6) * 40;
  return { id: newRoomId(), name: `${DEFAULT_ROOM_NAME} ${n + 1}`, ...clampRoomRect({ x: 340 + off, y: 340 + off, w: 320, h: 260 }), color };
}

/** Πρώτη θέση (από πάνω αριστερά, σειρά-σειρά) όπου ένα ορθογώνιο w×h δεν πέφτει πάνω σε άλλο στοιχείο του σχεδίου. */
export function freeRect(existing: { x: number; y: number; w: number; h: number }[], w: number, h: number) {
  const size = clampRoomRect({ x: 0, y: 0, w, h });
  const gap = 20;
  for (let y = 30; y + size.h <= 1000; y += 50) {
    for (let x = 30; x + size.w <= 1000; x += 50) {
      const hit = existing.some((r) => x < r.x + r.w + gap && x + size.w + gap > r.x && y < r.y + r.h + gap && y + size.h + gap > r.y);
      if (!hit) return { x, y, w: size.w, h: size.h };
    }
  }
  return clampRoomRect({ x: 60 + (existing.length % 6) * 40, y: 60 + (existing.length % 6) * 40, w, h });
}

/** Νέο έτοιμο στοιχείο (μπαρ, τζάκι…): προεπιλεγμένο μέγεθος και χρώμα, όνομα με αρίθμηση αν υπάρχει ήδη ίδιο. */
export function nextFixture(existing: PlanRoom[], kind: FixtureKind): PlanRoom {
  const f = fixtureOf(kind)!;
  const same = existing.filter((r) => r.kind === kind).length;
  return {
    id: newRoomId(),
    name: same ? `${f.label} ${same + 1}` : f.label,
    ...freeRect(existing, f.w, f.h),
    color: f.color,
    kind,
  };
}

export function samePlan(a: PlanRoom[], b: PlanRoom[]) {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const o = b[i];
      return r.id === o.id && r.name === o.name && r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h && (r.color ?? DEFAULT_ROOM_COLOR) === (o.color ?? DEFAULT_ROOM_COLOR) && (r.kind ?? "") === (o.kind ?? "");
    })
  );
}
