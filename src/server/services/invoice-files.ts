/**
 * Συνημμένα παραστατικά: έλεγχος αρχείου, ανέβασμα στο Google Drive, ανάγνωση με AI.
 * Τα route handlers (/api/invoices/*) ελέγχουν τον ρόλο και καλούν αυτές τις συναρτήσεις.
 */
import { getDb } from "@/db";
import { audit } from "@/server/audit";
import type { InvoiceFeatures } from "@/components/admin/finance/meta";
import { INVOICE_MAX_BYTES, sniffInvoiceFile, validIsoDate, type InvoiceFileKind, type InvoiceReading } from "@/lib/invoices";
import { driveStatus, uploadInvoiceToDrive, type DriveFile } from "./google-drive";
import { aiConfigured, readInvoiceWithAi } from "./invoice-ai";
import { todayAthens } from "./reports";
import { getSettings } from "./settings";

/** Τι δείχνει η φόρμα τιμολογίου: επισύναψη μόνο με συνδεδεμένο Drive, «Ανάγνωση» μόνο με κλειδί AI. */
export async function invoiceFeatures(): Promise<InvoiceFeatures> {
  const d = await driveStatus();
  return { drive: d.configured && d.connected, driveNeedsReconnect: d.configured && d.connected && d.needsReconnect, ai: aiConfigured() };
}

export const FILE_TOO_BIG = "Το αρχείο ξεπερνά τα 10 MB. Διάλεξε μικρότερο αρχείο ή φωτογραφία χαμηλότερης ανάλυσης.";
export const FILE_BAD_TYPE = "Επιτρέπονται μόνο PDF και φωτογραφίες JPG, PNG, WEBP ή HEIC.";
export const FILE_MISSING = "Δεν έφτασε αρχείο. Διάλεξέ το ξανά.";

/** Έλεγχος μεγέθους και πραγματικού τύπου (από τα bytes, όχι από το όνομα). */
export function checkInvoiceFile(bytes: Uint8Array): InvoiceFileKind {
  if (!bytes.length) throw new Error(FILE_MISSING);
  if (bytes.length > INVOICE_MAX_BYTES) throw new Error(FILE_TOO_BIG);
  const kind = sniffInvoiceFile(bytes);
  if (!kind) throw new Error(FILE_BAD_TYPE);
  return kind;
}

/** Διαβάζει το πεδίο "file" ενός multipart αιτήματος. */
export async function fileFromForm(fd: FormData): Promise<Uint8Array> {
  const f = fd.get("file");
  if (!f || typeof f === "string" || typeof f.arrayBuffer !== "function") throw new Error(FILE_MISSING);
  if (f.size > INVOICE_MAX_BYTES) throw new Error(FILE_TOO_BIG);
  return new Uint8Array(await f.arrayBuffer());
}

export async function uploadInvoiceFile(input: { bytes: Uint8Array; date: string; supplier?: string | null; docNumber?: string | null }, employeeId: number): Promise<DriveFile> {
  const kind = checkInvoiceFile(input.bytes);
  if (!validIsoDate(input.date)) throw new Error("Μη έγκυρη ημερομηνία παραστατικού");
  const file = await uploadInvoiceToDrive({ bytes: input.bytes, kind, date: input.date, supplier: input.supplier, docNumber: input.docNumber });
  await audit(await getDb(), employeeId, "invoice_upload", "drive_file", null, { name: file.name, bytes: input.bytes.length });
  return file;
}

export async function readInvoiceFile(input: { bytes: Uint8Array }): Promise<InvoiceReading> {
  const kind = checkInvoiceFile(input.bytes);
  const settings = await getSettings();
  return readInvoiceWithAi({ bytes: input.bytes, kind, ownAfm: settings.vatNumber, today: todayAthens() });
}
