/**
 * Προαιρετική ανάγνωση τιμολογίου με το Anthropic Messages API (μόνο αν οριστεί ANTHROPIC_API_KEY).
 *  - Στέλνεται ΜΟΝΟ το αρχείο (εικόνα ή PDF, base64) και η οδηγία. Κανένα άλλο στοιχείο του καταστήματος.
 *  - Το αποτέλεσμα μόνο προσυμπληρώνει τη φόρμα και ελέγχεται ξανά τοπικά (lib/invoices: normalizeReading).
 *  - Καθαρό fetch (τρέχει σε Cloudflare Workers), με χρονικό όριο.
 */
import { AI_IMAGE_MAX_BYTES, extractJsonObject, normalizeReading, type InvoiceFileKind, type InvoiceReading } from "@/lib/invoices";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";
export const DEFAULT_INVOICE_MODEL = "claude-sonnet-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Μοντέλα όπου ισχύει ο αυτόματος εφεδρικός δρόμος του API όταν ένα φίλτρο ασφαλείας αρνηθεί το αίτημα. */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1"]);
const TIMEOUT_MS = 75_000;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function invoiceModel(): string {
  return process.env.INVOICE_AI_MODEL?.trim() || DEFAULT_INVOICE_MODEL;
}

/** Σφάλμα με μήνυμα έτοιμο για τον χρήστη (ελληνικά). */
export class InvoiceAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceAiError";
  }
}

const MANUAL = "Συμπλήρωσε τα πεδία με το χέρι.";

export const INVOICE_INSTRUCTION = `The attached file is a supplier invoice or receipt issued to a business in Greece (the text is usually Greek). Read it and return the fields below.

- supplier_name: the ISSUER (seller) of the document, exactly as printed. Not the customer/recipient.
- supplier_afm: the issuer's Greek tax number (ΑΦΜ): 9 digits, digits only. Not the customer's ΑΦΜ.
- document_number: series and number as printed (for example "ΤΔΑ 1532").
- document_date: the issue date as YYYY-MM-DD (Greek documents print DD/MM/YYYY).
- net_amount: total net value before VAT (καθαρή αξία).
- vat_amount: total VAT (ΦΠΑ).
- total_amount: the final payable total including VAT (πληρωτέο / γενικό σύνολο).
- currency: ISO 4217 code, for example "EUR".
- confidence: for every field one of "high" (clearly printed and unambiguous), "medium" (partly unclear or inferred), "low" (a guess).

Amounts are plain numbers with a dot as the decimal separator, without thousands separators or currency symbols. Use null for anything that is not printed or not legible; never invent a value. If the file is not an invoice or receipt, return null for every field with confidence "low".`;

const nullable = (type: "string" | "number") => ({ anyOf: [{ type }, { type: "null" }] });
const FIELDS = ["supplier_name", "supplier_afm", "document_number", "document_date", "net_amount", "vat_amount", "total_amount"] as const;

export const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...FIELDS, "currency", "confidence"],
  properties: {
    supplier_name: nullable("string"),
    supplier_afm: nullable("string"),
    document_number: nullable("string"),
    document_date: nullable("string"),
    net_amount: nullable("number"),
    vat_amount: nullable("number"),
    total_amount: nullable("number"),
    currency: nullable("string"),
    confidence: {
      type: "object",
      additionalProperties: false,
      required: [...FIELDS],
      properties: Object.fromEntries(FIELDS.map((f) => [f, { type: "string", enum: ["high", "medium", "low"] }])),
    },
  },
} as const;

const IMAGE_TYPES: Partial<Record<InvoiceFileKind, string>> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** Το σώμα του αιτήματος: το αρχείο και η οδηγία, τίποτα άλλο. */
export function buildInvoiceRequest(input: { bytes: Uint8Array; kind: InvoiceFileKind; model?: string }) {
  const model = input.model ?? invoiceModel();
  const data = toBase64(input.bytes);
  const imageType = IMAGE_TYPES[input.kind];
  const file =
    input.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: imageType, data } };
  const fallback = FALLBACK_MODELS.has(model);
  return {
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY?.trim() ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
      ...(fallback ? { "anthropic-beta": FALLBACK_BETA } : {}),
    },
    body: {
      model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: INVOICE_SCHEMA } },
      ...(fallback ? { fallbacks: "default" } : {}),
      messages: [{ role: "user", content: [file, { type: "text", text: INVOICE_INSTRUCTION }] }],
    },
  };
}

/** Από την απάντηση του Messages API στο ελεγμένο αποτέλεσμα για τη φόρμα. */
export function parseInvoiceResponse(response: unknown, opts: { ownAfm?: string | null; today?: string } = {}): InvoiceReading {
  const r = (response && typeof response === "object" ? response : {}) as { stop_reason?: unknown; content?: unknown };
  if (r.stop_reason === "refusal") throw new InvoiceAiError(`Η υπηρεσία ανάγνωσης αρνήθηκε αυτό το αρχείο. ${MANUAL}`);
  if (r.stop_reason === "max_tokens") throw new InvoiceAiError(`Η ανάγνωση δεν ολοκληρώθηκε (πολύ μεγάλο έγγραφο). ${MANUAL}`);
  const blocks = Array.isArray(r.content) ? (r.content as { type?: unknown; text?: unknown }[]) : [];
  const text = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    // Χωρίς διαχωριστικό: αν η απάντηση έρθει σε περισσότερα text blocks, το JSON συνεχίζει ακριβώς εκεί που σταμάτησε.
    .join("")
    .trim();
  if (!text) throw new InvoiceAiError(`Η ανάγνωση δεν επέστρεψε στοιχεία. ${MANUAL}`);
  return normalizeReading(extractJsonObject(text), opts);
}

function httpFailure(status: number, model: string): InvoiceAiError {
  if (status === 401 || status === 403) return new InvoiceAiError("Το κλειδί ANTHROPIC_API_KEY δεν έγινε δεκτό. Έλεγξέ το στις ρυθμίσεις του server.");
  if (status === 404) return new InvoiceAiError(`Το μοντέλο ανάγνωσης «${model}» δεν βρέθηκε. Έλεγξε τη μεταβλητή INVOICE_AI_MODEL.`);
  if (status === 413) return new InvoiceAiError(`Το αρχείο είναι πολύ μεγάλο για ανάγνωση. ${MANUAL}`);
  if (status === 429) return new InvoiceAiError("Η υπηρεσία ανάγνωσης δέχεται πολλά αιτήματα. Δοκίμασε ξανά σε ένα λεπτό.");
  if (status === 400) return new InvoiceAiError(`Η υπηρεσία ανάγνωσης δεν δέχτηκε το αίτημα (ίσως το αρχείο είναι κλειδωμένο ή χαλασμένο, ή το μοντέλο «${model}» δεν ταιριάζει). ${MANUAL}`);
  if (status >= 500) return new InvoiceAiError(`Η υπηρεσία ανάγνωσης δεν είναι διαθέσιμη αυτή τη στιγμή (σφάλμα ${status}). Δοκίμασε ξανά ή ${MANUAL.toLowerCase()}`);
  return new InvoiceAiError(`Η ανάγνωση απέτυχε (σφάλμα ${status}). ${MANUAL}`);
}

/** Στέλνει το αρχείο για ανάγνωση. Πετάει InvoiceAiError με καθαρό μήνυμα σε κάθε αποτυχία. */
export async function readInvoiceWithAi(input: { bytes: Uint8Array; kind: InvoiceFileKind; ownAfm?: string | null; today?: string }): Promise<InvoiceReading> {
  if (!aiConfigured()) throw new InvoiceAiError("Η ανάγνωση τιμολογίων δεν είναι ενεργή (λείπει το ANTHROPIC_API_KEY).");
  if (input.kind === "heic") throw new InvoiceAiError("Η ανάγνωση δεν υποστηρίζει φωτογραφίες HEIC. Τράβηξε τη φωτογραφία ως JPG ή ανέβασε PDF· το αρχείο θα αποθηκευτεί κανονικά.");
  if (input.kind !== "pdf" && input.bytes.length > AI_IMAGE_MAX_BYTES) {
    throw new InvoiceAiError("Η φωτογραφία είναι πολύ μεγάλη για ανάγνωση (πάνω από 7 MB). Τράβηξέ την σε μικρότερη ανάλυση ή συμπλήρωσε τα πεδία με το χέρι.");
  }
  const req = buildInvoiceRequest(input);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal });
  } catch {
    throw new InvoiceAiError(
      ctrl.signal.aborted ? `Η ανάγνωση άργησε πολύ και διακόπηκε. Δοκίμασε ξανά ή ${MANUAL.toLowerCase()}` : `Δεν υπάρχει επικοινωνία με την υπηρεσία ανάγνωσης. Δοκίμασε ξανά ή ${MANUAL.toLowerCase()}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let type = "";
    try {
      type = String(((await res.json()) as { error?: { type?: unknown } })?.error?.type ?? "");
    } catch {
      /* χωρίς σώμα */
    }
    console.error(`[nido] invoice AI: HTTP ${res.status} ${type}`);
    throw httpFailure(res.status, req.body.model);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new InvoiceAiError(`Η υπηρεσία ανάγνωσης έστειλε μη αναγνώσιμη απάντηση. ${MANUAL}`);
  }
  return parseInvoiceResponse(payload, { ownAfm: input.ownAfm, today: input.today });
}
