/**
 * Αντιστοίχιση γραμμών τιμολογίου προμηθευτή σε πρώτες ύλες (καθαρές συναρτήσεις: τρέχουν σε server και browser).
 *
 * Ο προμηθευτής γράφει «ΑΛΕΥΡΙ ΓΙΑ ΟΛΕΣ ΤΙΣ ΧΡΗΣΕΙΣ 1KG» σε κιλά, εμείς κρατάμε το αλεύρι σε γραμμάρια.
 * Ο «συντελεστής» λέει πόσες μονάδες της πρώτης ύλης είναι 1 μονάδα του τιμολογίου (1 κιλό = 1000 γρ., 1 κιβώτιο = 24 τεμ.).
 */

export type StockUnitLike = "g" | "kg" | "ml" | "l" | "pcs";

/** Κλειδί γραμμής: πεζά, χωρίς τόνους/σημεία στίξης/διπλά κενά. Ίδια περιγραφή στο επόμενο τιμολόγιο => ίδιο κλειδί. */
export function normalizeItemKey(description: string, code?: string | null): string {
  const text = description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}.,]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const c = (code ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return c ? `${c}|${text}` : text;
}

/** Μονάδα τιμολογίου → βασική μονάδα (ή null αν είναι «τεμάχιο/κιβώτιο/φιάλη…» χωρίς βάρος/όγκο). */
export function invoiceUnitKind(unit: string | null | undefined): "kg" | "g" | "l" | "ml" | "pcs" | null {
  const u = (unit ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-zα-ω]/g, "");
  if (!u) return null;
  if (["kg", "kgr", "kilo", "κιλ", "κιλο", "κιλα", "κγρ", "κγ", "κιλα"].includes(u) || u.startsWith("κιλ")) return "kg";
  if (["g", "gr", "γρ", "γραμ", "γραμμαρια"].includes(u)) return "g";
  if (["l", "lt", "ltr", "λιτ", "λιτρο", "λιτρα", "λτ"].includes(u) || u.startsWith("λιτ")) return "l";
  if (["ml", "μλ"].includes(u)) return "ml";
  if (["τεμ", "τεμαχιο", "τεμαχια", "τμχ", "pcs", "pc", "τ"].includes(u) || u.startsWith("τεμ")) return "pcs";
  return null;
}

/**
 * Προτεινόμενος συντελεστής μετατροπής από τη μονάδα του τιμολογίου στη μονάδα της πρώτης ύλης.
 * Με συσκευασία (π.χ. φιάλη 700 ml) ένα «τεμάχιο/φιάλη» του τιμολογίου είναι μία συσκευασία.
 * null = δεν μπορεί να το μαντέψει: ο χρήστης το συμπληρώνει (και θυμάται για την επόμενη φορά).
 */
export function guessFactor(invoiceUnit: string | null | undefined, ingredientUnit: StockUnitLike, packSize?: number | null): number | null {
  const kind = invoiceUnitKind(invoiceUnit);
  const table: Record<string, Partial<Record<StockUnitLike, number>>> = {
    kg: { kg: 1, g: 1000 },
    g: { g: 1, kg: 0.001 },
    l: { l: 1, ml: 1000 },
    ml: { ml: 1, l: 0.001 },
    pcs: { pcs: 1 },
  };
  if (kind && table[kind][ingredientUnit] !== undefined) return table[kind][ingredientUnit]!;
  // Τεμάχιο/φιάλη/συσκευασία του τιμολογίου σε πρώτη ύλη με βάρος/όγκο: μία συσκευασία.
  if ((kind === "pcs" || kind === null) && ingredientUnit !== "pcs" && packSize && packSize > 0) return packSize;
  if (kind === null && ingredientUnit === "pcs") return 1;
  return null;
}

function words(s: string): string[] {
  return normalizeItemKey(s)
    .split(" ")
    .filter((w) => w.length >= 3 && !/^\d/.test(w));
}

/**
 * Πόσο μοιάζει η περιγραφή του τιμολογίου με το όνομα της πρώτης ύλης (0..1).
 * Απλό ταίριασμα λέξεων (και αρχών λέξεων: «ΝΤΟΜΑΤ» ~ «ντομάτες»), αρκετό για πρόταση· την τελική επιλογή την κάνει ο χρήστης.
 */
export function nameScore(description: string, ingredientName: string): number {
  const a = words(description);
  const b = words(ingredientName);
  if (!a.length || !b.length) return 0;
  let hit = 0;
  for (const w of b) {
    const stem = w.slice(0, Math.max(4, w.length - 2));
    if (a.some((x) => x === w || x.startsWith(stem) || w.startsWith(x.slice(0, Math.max(4, x.length - 2))))) hit++;
  }
  return hit / b.length;
}

/** Η καλύτερη πρόταση πρώτης ύλης για μια περιγραφή (μόνο αν μοιάζει αρκετά). */
export function suggestIngredient<T extends { id: number; name: string }>(description: string, ingredients: T[], min = 0.5): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const ing of ingredients) {
    const s = nameScore(description, ing.name);
    if (s > bestScore) {
      best = ing;
      bestScore = s;
    }
  }
  return bestScore >= min ? best : null;
}

/** Ποσότητα και κόστος/μονάδα στη μονάδα της πρώτης ύλης. Το κόστος είναι χωρίς ΦΠΑ. */
export function convertLine(qty: number, unitPriceNet: number, factor: number): { qty: number; unitCost: number } {
  if (!(factor > 0)) throw new Error("Μη έγκυρος συντελεστής μονάδας");
  return { qty: qty * factor, unitCost: unitPriceNet / factor };
}

/** Μόνο τα ψηφία του ΑΦΜ (χωρίς «EL», κενά, τελείες). */
export function cleanVat(vat: string | null | undefined): string {
  return (vat ?? "").replace(/^\s*(EL|GR)\s*/i, "").replace(/\D/g, "");
}
