/**
 * Τιμολόγια προμηθευτών: καθαροί υπολογισμοί (κοινοί για server και browser, χωρίς βάση ή δίκτυο).
 * Ποσά σε λεπτά, ημερομηνίες "YYYY-MM-DD".
 */

/* ------------------------------ ΑΦΜ ------------------------------ */

/** Κρατά μόνο τα ψηφία (δέχεται "EL 123456789", "GR123456789", κενά, παύλες). */
export function cleanAfm(input: string | null | undefined): string {
  return String(input ?? "").replace(/\D/g, "");
}

/** Ελληνικό ΑΦΜ: 9 ψηφία, το τελευταίο είναι ψηφίο ελέγχου (βάρη 2^8…2^1, mod 11, mod 10). */
export function validAfm(input: string | null | undefined): boolean {
  const afm = String(input ?? "").trim();
  if (!/^\d{9}$/.test(afm) || afm === "000000000") return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(afm[i]) * 2 ** (8 - i);
  return (sum % 11) % 10 === Number(afm[8]);
}

/* ------------------------------ Ποσά ------------------------------ */

export type TotalsField = "net" | "vat" | "total";
export type Totals = Record<TotalsField, number | null>;

/**
 * Από δύο γνωστά ποσά υπολογίζει το τρίτο. `keep` = τα δύο πεδία που ισχύουν (π.χ. όσα πληκτρολόγησε τελευταία ο χρήστης).
 * Αν λείπει κάποιο από τα δύο, δεν αλλάζει τίποτα.
 */
export function solveTotals(t: Totals, keep?: [TotalsField, TotalsField]): Totals & { computed: TotalsField | null } {
  const fields: TotalsField[] = ["net", "vat", "total"];
  const known = keep ?? (fields.filter((f) => t[f] !== null).slice(0, 2) as [TotalsField, TotalsField]);
  if (known.length < 2 || known[0] === known[1] || t[known[0]] === null || t[known[1]] === null) return { ...t, computed: null };
  const target = fields.find((f) => !known.includes(f))!;
  if (!keep && t[target] !== null) return { ...t, computed: null };
  const out = { ...t };
  if (target === "total") out.total = t.net! + t.vat!;
  else if (target === "vat") out.vat = t.total! - t.net!;
  else out.net = t.total! - t.vat!;
  return { ...out, computed: target };
}

/** Διαφορά (καθαρό + ΦΠΑ) − σύνολο σε λεπτά· null όταν λείπει κάποιο ποσό. 0 = συμφωνούν. */
export function totalsDiff(t: Totals): number | null {
  if (t.net === null || t.vat === null || t.total === null) return null;
  return t.net + t.vat - t.total;
}

/** ΦΠΑ και σύνολο από καθαρή αξία. */
export function fromNet(netCents: number, ratePct: number) {
  const vat = Math.round((netCents * ratePct) / 100);
  return { net: netCents, vat, total: netCents + vat };
}

/** Καθαρή αξία και ΦΠΑ από τελικό ποσό. */
export function fromTotal(totalCents: number, ratePct: number) {
  const vat = Math.round(totalCents - totalCents / (1 + ratePct / 100));
  return { net: totalCents - vat, vat, total: totalCents };
}

/**
 * Ποσό από κείμενο ή αριθμό σε λεπτά. Δέχεται ελληνική ("1.234,56") και αγγλική ("1,234.56") γραφή.
 * Επιστρέφει null όταν δεν είναι ποσό.
 */
export function amountToCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s€$£]|EUR/gi, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Το τελευταίο σημάδι είναι η υποδιαστολή, το άλλο χωρίζει χιλιάδες.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

/* ---------------------------- Ημερομηνίες ---------------------------- */

/** Πραγματική ημερομηνία "YYYY-MM-DD" (όχι 2026-02-31). */
export function validIsoDate(s: unknown): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Δέχεται "YYYY-MM-DD" ή "DD/MM/YYYY" (και με τελείες ή παύλες) και επιστρέφει "YYYY-MM-DD" ή null. */
export function parseDocDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (validIsoDate(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return validIsoDate(iso) ? iso : null;
}

/* ------------------------------ Αρχεία ------------------------------ */

export const INVOICE_MAX_BYTES = 10 * 1024 * 1024;
/** Όριο της υπηρεσίας ανάγνωσης για εικόνες (10 MB σε base64 ≈ 7,5 MB αρχείο). */
export const AI_IMAGE_MAX_BYTES = 7 * 1024 * 1024;
export const INVOICE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

export type InvoiceFileKind = "pdf" | "jpg" | "png" | "webp" | "heic";
export const INVOICE_MIME: Record<InvoiceFileKind, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Αναγνωρίζει τον τύπο από τα πρώτα bytes του αρχείου (όχι από το όνομα). null = δεν επιτρέπεται. */
export function sniffInvoiceFile(bytes: Uint8Array): InvoiceFileKind | null {
  if (bytes.length < 12) return null;
  // Ορισμένα PDF έχουν λίγα bytes πριν από την κεφαλίδα.
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes("%PDF-")) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(bytes, 8, 12))) return "heic";
  return null;
}

/** Καθαρό κομμάτι ονόματος αρχείου: χωρίς / \ : * ? " < > | και χαρακτήρες ελέγχου, με μονά κενά. */
export function sanitizeFilePart(s: string | null | undefined, max = 60): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, max)
    .trim();
}

/** "<YYYY-MM-DD> <προμηθευτής> <αρ. παραστατικού>.<ext>" */
export function invoiceFileName(input: { date: string; supplier?: string | null; docNumber?: string | null; ext: InvoiceFileKind }): string {
  const date = validIsoDate(input.date) ? input.date : "0000-00-00";
  const parts = [date, sanitizeFilePart(input.supplier) || "Χωρίς προμηθευτή", sanitizeFilePart(input.docNumber, 40)].filter(Boolean);
  return `${parts.join(" ")}.${input.ext}`;
}

/** Φάκελοι στο Drive για ένα παραστατικό: ["Nido Τιμολόγια", "2026", "11"]. */
export const DRIVE_ROOT_FOLDER = "Nido Τιμολόγια";
export function invoiceFolderPath(date: string): [string, string, string] {
  if (!validIsoDate(date)) throw new Error("Μη έγκυρη ημερομηνία παραστατικού");
  return [DRIVE_ROOT_FOLDER, date.slice(0, 4), date.slice(5, 7)];
}

/* ------------------------- Ανάγνωση τιμολογίου ------------------------- */

export type ReadingField = "supplierName" | "afm" | "docNumber" | "date" | "net" | "vat" | "total";
export type Confidence = "high" | "medium" | "low";

export type InvoiceReading = {
  supplierName: string | null;
  afm: string | null;
  docNumber: string | null;
  date: string | null;
  netCents: number | null;
  vatCents: number | null;
  totalCents: number | null;
  currency: string | null;
  confidence: Record<ReadingField, Confidence>;
  /** Πεδία που ο χρήστης πρέπει να ελέγξει (λείπουν, χαμηλή βεβαιότητα ή απέτυχαν στον τοπικό έλεγχο). */
  check: ReadingField[];
  /** Μηνύματα του τοπικού ελέγχου, στα ελληνικά. */
  warnings: string[];
};

export const READING_FIELDS: ReadingField[] = ["supplierName", "afm", "docNumber", "date", "net", "vat", "total"];

const RAW_KEY: Record<ReadingField, string> = {
  supplierName: "supplier_name",
  afm: "supplier_afm",
  docNumber: "document_number",
  date: "document_date",
  net: "net_amount",
  vat: "vat_amount",
  total: "total_amount",
};

function toConfidence(v: unknown): Confidence {
  if (typeof v === "number" && Number.isFinite(v)) return v >= 0.85 ? "high" : v >= 0.5 ? "medium" : "low";
  const s = String(v ?? "").toLowerCase();
  return s === "high" ? "high" : s === "medium" ? "medium" : "low";
}

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) || null : null);

/**
 * Βγάζει το JSON από την απάντηση του μοντέλου. Ανέχεται ```json … ``` και κείμενο γύρω από το αντικείμενο.
 * Πετάει σφάλμα (στα ελληνικά) όταν δεν υπάρχει έγκυρο αντικείμενο.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const tryParse = (t: string) => {
    try {
      const v: unknown = JSON.parse(t);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  const inner = a >= 0 && b > a ? tryParse(s.slice(a, b + 1)) : null;
  if (inner) return inner;
  throw new Error("Η ανάγνωση δεν έδωσε αξιοποιήσιμα στοιχεία. Συμπλήρωσε τα πεδία με το χέρι.");
}

/**
 * Κανονικοποιεί και ΕΛΕΓΧΕΙ ΤΟΠΙΚΑ ό,τι διάβασε το μοντέλο: τύποι, ΑΦΜ (9 ψηφία + ψηφίο ελέγχου), καθαρό + ΦΠΑ = σύνολο.
 * Το αποτέλεσμα μόνο προσυμπληρώνει τη φόρμα· τίποτα δεν αποθηκεύεται από εδώ.
 */
export function normalizeReading(raw: Record<string, unknown>, opts: { ownAfm?: string | null; today?: string } = {}): InvoiceReading {
  const conf = (raw.confidence && typeof raw.confidence === "object" ? raw.confidence : {}) as Record<string, unknown>;
  const confidence = Object.fromEntries(READING_FIELDS.map((f) => [f, toConfidence(conf[RAW_KEY[f]] ?? conf[f])])) as Record<ReadingField, Confidence>;
  const warnings: string[] = [];
  const check = new Set<ReadingField>();

  const supplierName = text(raw[RAW_KEY.supplierName], 120);
  const docNumber = text(raw[RAW_KEY.docNumber], 60);
  let afm: string | null = cleanAfm(text(raw[RAW_KEY.afm], 30)) || null;
  let date = parseDocDate(raw[RAW_KEY.date]);
  let net = amountToCents(raw[RAW_KEY.net]);
  let vat = amountToCents(raw[RAW_KEY.vat]);
  let total = amountToCents(raw[RAW_KEY.total]);
  const currency = text(raw.currency, 8)?.toUpperCase() ?? null;

  if (afm && !validAfm(afm)) {
    warnings.push(`Το ΑΦΜ που διαβάστηκε (${afm}) δεν περνά τον έλεγχο — έλεγξέ το στο παραστατικό.`);
    check.add("afm");
  }
  const own = cleanAfm(opts.ownAfm);
  if (afm && own && afm === own) {
    warnings.push("Διαβάστηκε το δικό σου ΑΦΜ αντί του προμηθευτή — συμπλήρωσε το ΑΦΜ του εκδότη.");
    afm = null;
    check.add("afm");
  }
  if (raw[RAW_KEY.date] && !date) warnings.push("Η ημερομηνία του παραστατικού δεν διαβάστηκε καθαρά.");
  if (date && opts.today && (date > opts.today || date < `${Number(opts.today.slice(0, 4)) - 2}${opts.today.slice(4)}`)) {
    warnings.push("Η ημερομηνία που διαβάστηκε φαίνεται ασυνήθιστη — έλεγξέ την.");
    check.add("date");
  }
  let negative = false;
  for (const [name, v] of [["net", net], ["vat", vat], ["total", total]] as const) {
    if (v !== null && v < 0) {
      // Πιστωτικά/αρνητικά ποσά δεν περνιούνται αυτόματα.
      if (name === "net") net = null;
      else if (name === "vat") vat = null;
      else total = null;
      check.add(name);
      negative = true;
    }
  }
  if (negative) warnings.push("Διαβάστηκαν αρνητικά ποσά (πιστωτικό τιμολόγιο;) και δεν προσυμπληρώθηκαν — γράψε τα ποσά με το χέρι.");
  const diff = totalsDiff({ net, vat, total });
  if (diff !== null && diff !== 0) {
    warnings.push("Καθαρό + ΦΠΑ δεν ισούται με το σύνολο που διαβάστηκε — έλεγξε τα ποσά.");
    check.add("net").add("vat").add("total");
  } else if (diff === null) {
    const solved = solveTotals({ net, vat, total });
    if (solved.computed && solved[solved.computed]! >= 0) {
      ({ net, vat, total } = solved);
      check.add(solved.computed);
    }
  }
  if (currency && currency !== "EUR" && currency !== "€") {
    warnings.push(`Το παραστατικό φαίνεται να είναι σε ${currency}, όχι σε ευρώ — έλεγξε τα ποσά.`);
    check.add("total");
  }

  const values: Record<ReadingField, unknown> = { supplierName, afm, docNumber, date, net, vat, total };
  for (const f of READING_FIELDS) if (values[f] === null || confidence[f] !== "high") check.add(f);
  if (!date) date = null;
  return { supplierName, afm, docNumber, date, netCents: net, vatCents: vat, totalCents: total, currency, confidence, check: READING_FIELDS.filter((f) => check.has(f)), warnings };
}
