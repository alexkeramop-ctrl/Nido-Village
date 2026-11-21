/**
 * Ανάγνωση τιμολογίου προμηθευτή (φωτογραφία ή PDF) με το Claude: προμηθευτής, ΑΦΜ, αριθμός, ημερομηνία και γραμμές.
 * Στέλνεται ΜΟΝΟ το αρχείο του παραστατικού (και το όνομα/ΑΦΜ του καταστήματος για να μη μπερδευτεί με τον εκδότη).
 * Το αποτέλεσμα είναι πρόταση: ο χρήστης το ελέγχει πριν γίνει παραλαβή.
 * Χρειάζεται το μυστικό ANTHROPIC_API_KEY (Cloudflare: Settings → Variables and Secrets, τύπος Secret).
 *
 * Γιατί απευθείας HTTP και όχι το SDK της Anthropic: το SDK μαζί με το zod προσθέτουν ~190 KB (gzip) στο worker και
 * το ξεπερνούν από το όριο των 3 MB του Cloudflare Workers Free. Η κλήση είναι μία (Messages API με structured output).
 */
import { getSettings } from "./settings";

export const INVOICE_MODEL = "claude-opus-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
/** Αν το μοντέλο αρνηθεί (σπάνιο σε τιμολόγια), το API ξαναδοκιμάζει αυτόματα σε άλλο μοντέλο μέσα στην ίδια κλήση. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Τα όρια που δέχεται η φόρμα (ο browser σμικρύνει τις φωτογραφίες πριν το ανέβασμα). */
export const INVOICE_MAX_BYTES = 8 * 1024 * 1024;
export const INVOICE_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type InvoiceMediaType = (typeof INVOICE_MEDIA_TYPES)[number];

export type ExtractedLine = {
  code: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price_net: number | null;
  discount_pct: number | null;
  line_net: number | null;
  vat_pct: number | null;
};

export type ExtractedInvoice = {
  is_invoice: boolean;
  supplier_name: string | null;
  supplier_vat: string | null;
  doc_type: string | null;
  doc_number: string | null;
  doc_date: string | null;
  lines: ExtractedLine[];
  total_net: number | null;
  total_vat: number | null;
  total_gross: number | null;
  warnings: string[];
};

/* ------------------------------ JSON schema (structured output) ------------------------------ */

const nullable = (type: "string" | "number", description?: string) => ({ anyOf: [{ type }, { type: "null" }], ...(description ? { description } : {}) });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const INVOICE_SCHEMA = obj({
  is_invoice: { type: "boolean", description: "true αν το αρχείο είναι παραστατικό αγοράς (τιμολόγιο, δελτίο αποστολής, απόδειξη)" },
  supplier_name: nullable("string", "Επωνυμία του ΕΚΔΟΤΗ (προμηθευτή), όχι του πελάτη"),
  supplier_vat: nullable("string", "ΑΦΜ του ΕΚΔΟΤΗ, μόνο ψηφία"),
  doc_type: nullable("string", "Είδος παραστατικού, π.χ. Τιμολόγιο Πώλησης, ΤΔΑ, Δελτίο Αποστολής"),
  doc_number: nullable("string", "Σειρά και αριθμός, π.χ. Α 1234"),
  doc_date: nullable("string", "Ημερομηνία έκδοσης σε μορφή YYYY-MM-DD"),
  lines: {
    type: "array",
    items: obj({
      code: nullable("string", "Κωδικός είδους του προμηθευτή, αν υπάρχει"),
      description: { type: "string", description: "Περιγραφή είδους όπως είναι τυπωμένη" },
      quantity: { type: "number", description: "Ποσότητα στη μονάδα του τιμολογίου" },
      unit: nullable("string", "Μονάδα μέτρησης όπως είναι τυπωμένη (ΚΙΛ, ΤΕΜ, ΛΙΤ, ΚΙΒ…)"),
      unit_price_net: nullable("number", "Τιμή μονάδας ΧΩΡΙΣ ΦΠΑ και ΜΕΤΑ την έκπτωση της γραμμής"),
      discount_pct: nullable("number", "Έκπτωση γραμμής %, αν υπάρχει"),
      line_net: nullable("number", "Καθαρή αξία γραμμής χωρίς ΦΠΑ"),
      vat_pct: nullable("number", "Συντελεστής ΦΠΑ % της γραμμής (π.χ. 13, 24)"),
    }),
  },
  total_net: nullable("number", "Σύνολο καθαρής αξίας χωρίς ΦΠΑ"),
  total_vat: nullable("number"),
  total_gross: nullable("number", "Πληρωτέο σύνολο με ΦΠΑ"),
  warnings: { type: "array", items: { type: "string" }, description: "Σύντομες προειδοποιήσεις στα ελληνικά για ό,τι δεν διαβάζεται καθαρά ή φαίνεται λάθος" },
});

const SYSTEM = `Διαβάζεις ελληνικά παραστατικά αγοράς (τιμολόγια, τιμολόγια-δελτία αποστολής, δελτία αποστολής, αποδείξεις) ενός καταστήματος εστίασης.
Τα στοιχεία σου θα γίνουν παραλαβή αποθήκης και θα υπολογίσουν το κόστος των πιάτων, οπότε η ακρίβεια μετράει περισσότερο από την πληρότητα.

Κανόνες:
- Προμηθευτής είναι ο ΕΚΔΟΤΗΣ του παραστατικού. Ο πελάτης/αγοραστής είναι το κατάστημα: μην βάλεις τα δικά του στοιχεία ως προμηθευτή.
- Γράψε όλες τις γραμμές ειδών με τη σειρά που εμφανίζονται, μία φορά η καθεμία. Μην προσθέσεις γραμμές που δεν υπάρχουν.
- Οι ελληνικοί αριθμοί γράφουν δεκαδικά με κόμμα (1.234,50 = 1234.5). Επέστρεψε αριθμούς JSON.
- unit_price_net: τιμή μονάδας χωρίς ΦΠΑ, μετά την έκπτωση της γραμμής. Αν υπάρχει μόνο καθαρή αξία γραμμής, διαίρεσέ την με την ποσότητα.
  Αν οι τιμές είναι τυπωμένες με ΦΠΑ, αφαίρεσε τον ΦΠΑ της γραμμής.
- Γραμμές που δεν είναι εμπόρευμα (μεταφορικά, εγγυοδοσία φιαλών, στρογγυλοποίηση) γράψε τες κι αυτές με την περιγραφή τους.
- Ό,τι δεν διαβάζεται με σιγουριά: null, και μια σύντομη προειδοποίηση στο warnings. Ποτέ μη μαντεύεις ποσά.
- Αν το αρχείο δεν είναι παραστατικό αγοράς: is_invoice=false και κενές γραμμές.`;

export class InvoiceReadError extends Error {}

export function invoiceReaderEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/* ------------------------------ Έλεγχος απάντησης ------------------------------ */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Το structured output εγγυάται το σχήμα· ελέγχουμε ξανά τους τύπους για να μη φτάσει ποτέ κάτι στραβό στη βάση. */
export function toExtractedInvoice(raw: unknown): ExtractedInvoice {
  if (!raw || typeof raw !== "object") throw new InvoiceReadError("Η ανάγνωση δεν έδωσε έγκυρο αποτέλεσμα.");
  const r = raw as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  return {
    is_invoice: r.is_invoice === true,
    supplier_name: str(r.supplier_name),
    supplier_vat: str(r.supplier_vat),
    doc_type: str(r.doc_type),
    doc_number: str(r.doc_number),
    doc_date: str(r.doc_date),
    lines: lines
      .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
      .map((l) => ({
        code: str(l.code),
        description: str(l.description) ?? "(χωρίς περιγραφή)",
        quantity: numOrNull(l.quantity) ?? 0,
        unit: str(l.unit),
        unit_price_net: numOrNull(l.unit_price_net),
        discount_pct: numOrNull(l.discount_pct),
        line_net: numOrNull(l.line_net),
        vat_pct: numOrNull(l.vat_pct),
      }))
      .slice(0, 200),
    total_net: numOrNull(r.total_net),
    total_vat: numOrNull(r.total_vat),
    total_gross: numOrNull(r.total_gross),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).map(str).filter((w): w is string => w !== null).slice(0, 20),
  };
}

type ApiResponse = {
  stop_reason?: string | null;
  content?: { type: string; text?: string }[];
  error?: { type?: string; message?: string };
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Μία κλήση στο Messages API με έως 2 επαναλήψεις σε 429/5xx/σφάλμα δικτύου (όπως κάνει και το SDK). */
async function callApi(apiKey: string, body: unknown): Promise<ApiResponse> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          "anthropic-beta": FALLBACK_BETA,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150_000),
      });
    } catch {
      if (attempt < 2) {
        await sleep(1000 * 3 ** attempt);
        continue;
      }
      throw new InvoiceReadError("Δεν υπάρχει σύνδεση με την υπηρεσία ανάγνωσης ή άργησε πολύ. Δοκίμασε ξανά.");
    }
    if (res.ok) return (await res.json()) as ApiResponse;
    lastStatus = res.status;
    const retryable = (res.status === 429 || res.status >= 500) && res.headers.get("x-should-retry") !== "false";
    if (retryable && attempt < 2) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 1000 * 3 ** attempt);
      continue;
    }
    const err = (await res.json().catch(() => null)) as ApiResponse | null;
    if (res.status === 401 || res.status === 403) throw new InvoiceReadError("Το κλειδί ANTHROPIC_API_KEY δεν είναι σωστό ή δεν έχει πρόσβαση.");
    if (res.status === 429) throw new InvoiceReadError("Πολλές αναγνώσεις μαζί ή τελείωσε το όριο του λογαριασμού. Δοκίμασε ξανά σε λίγο.");
    if (res.status === 400 || res.status === 413) {
      console.error("invoice read rejected", res.status, err?.error?.message);
      throw new InvoiceReadError("Το αρχείο δεν μπόρεσε να διαβαστεί (ίσως είναι κατεστραμμένο, κλειδωμένο PDF ή πολύ μεγάλο).");
    }
    break;
  }
  throw new InvoiceReadError(`Η υπηρεσία ανάγνωσης απάντησε με σφάλμα (${lastStatus}). Δοκίμασε ξανά σε λίγο.`);
}

/** Διαβάζει ένα παραστατικό. Πετάει InvoiceReadError με μήνυμα για τον χρήστη. */
export async function readInvoiceFile(file: { data: Uint8Array; mediaType: InvoiceMediaType }): Promise<ExtractedInvoice> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new InvoiceReadError("Η ανάγνωση τιμολογίων δεν είναι ενεργή: λείπει το μυστικό ANTHROPIC_API_KEY.");
  if (!file.data.byteLength) throw new InvoiceReadError("Το αρχείο είναι άδειο.");
  if (file.data.byteLength > INVOICE_MAX_BYTES) throw new InvoiceReadError("Το αρχείο είναι πάνω από 8 MB.");
  const data = Buffer.from(file.data).toString("base64");
  const fileBlock =
    file.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: file.mediaType, data } };

  const settings = await getSettings();
  const buyer = [settings.venueName, settings.vatNumber ? `ΑΦΜ ${settings.vatNumber}` : null].filter(Boolean).join(", ");
  const response = await callApi(apiKey, {
    model: INVOICE_MODEL,
    max_tokens: 16000,
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: INVOICE_SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: `Ο αγοραστής (το κατάστημα) είναι: ${buyer || "—"}. Διάβασε αυτό το παραστατικό.` }],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new InvoiceReadError("Η υπηρεσία δεν διάβασε αυτό το αρχείο. Καταχώρησέ το χειροκίνητα.");
  if (response.stop_reason === "max_tokens") throw new InvoiceReadError("Το παραστατικό είναι πολύ μεγάλο για μία ανάγνωση. Ανέβασέ το σε μικρότερα κομμάτια (σελίδες).");
  const text = (response.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvoiceReadError("Η ανάγνωση δεν έδωσε έγκυρο αποτέλεσμα. Δοκίμασε ξανά με πιο καθαρή φωτογραφία.");
  }
  return toExtractedInvoice(parsed);
}
