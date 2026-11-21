import { getSessionUser, hasRole } from "@/server/auth";
import { INVOICE_MAX_BYTES, INVOICE_MEDIA_TYPES, InvoiceReadError, readInvoiceFile, type InvoiceMediaType } from "@/server/services/invoice-reader";
import { draftFromExtraction } from "@/server/services/invoice-receipt";

export const dynamic = "force-dynamic";

/**
 * Ανάγνωση τιμολογίου (φωτογραφία/PDF) για την Παραλαβή. Route και όχι server action: το αρχείο μπορεί να είναι
 * μέχρι 8 MB και η ανάγνωση κρατά 10–60 δευτερόλεπτα. Επιστρέφει πρόταση παραλαβής· δεν γράφει τίποτα στη βάση.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !hasRole(user, "manager")) return Response.json({ ok: false, error: "Δεν έχεις δικαίωμα." }, { status: 401 });
  let file: File | null = null;
  try {
    const fd = await req.formData();
    const f = fd.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return Response.json({ ok: false, error: "Δεν στάλθηκε αρχείο." }, { status: 400 });
  }
  if (!file) return Response.json({ ok: false, error: "Δεν στάλθηκε αρχείο." }, { status: 400 });
  const mediaType = file.type as InvoiceMediaType;
  if (!INVOICE_MEDIA_TYPES.includes(mediaType)) {
    return Response.json({ ok: false, error: "Δέχεται φωτογραφία (JPG, PNG, WEBP) ή PDF." }, { status: 415 });
  }
  if (file.size > INVOICE_MAX_BYTES) return Response.json({ ok: false, error: "Το αρχείο είναι πάνω από 8 MB." }, { status: 413 });
  try {
    const extracted = await readInvoiceFile({ data: new Uint8Array(await file.arrayBuffer()), mediaType });
    const draft = await draftFromExtraction(extracted);
    return Response.json({ ok: true, draft }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof InvoiceReadError) return Response.json({ ok: false, error: e.message }, { status: 422 });
    console.error("invoice read failed", e);
    return Response.json({ ok: false, error: "Η ανάγνωση απέτυχε. Δοκίμασε ξανά." }, { status: 500 });
  }
}
