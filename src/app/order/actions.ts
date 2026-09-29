"use server";
import { redirect } from "next/navigation";
import { run, type ActionResult } from "@/server/action";
import { placeQrOrder, type QrOrderInput } from "@/server/services/public-order";

const MAX_LINES = 30;
const MAX_QTY = 20;

/** Καθαρίζει την είσοδο του πελάτη: μόνο τα πεδία που περιμένουμε, με όρια. */
function sanitize(input: QrOrderInput): QrOrderInput {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  return {
    customerName: String(input?.customerName ?? "").trim().slice(0, 40),
    customerPhone: input?.customerPhone ? String(input.customerPhone).trim().slice(0, 20) : null,
    notes: input?.notes ? String(input.notes).trim().slice(0, 200) : null,
    lines: lines.slice(0, MAX_LINES).map((l) => ({
      productId: Number(l?.productId),
      qty: Math.min(MAX_QTY, Math.max(0, Math.round(Number(l?.qty) || 0))),
      modifierIds: Array.isArray(l?.modifierIds) ? l.modifierIds.map(Number).filter((n) => Number.isFinite(n)) : [],
      notes: l?.notes ? String(l.notes).trim().slice(0, 120) : null,
    })),
  };
}

/**
 * Καταχώρηση παραγγελίας πελάτη (δημόσιο, χωρίς σύνδεση).
 * Σε επιτυχία κάνει redirect στη σελίδα κατάστασης· σε σφάλμα επιστρέφει { ok: false, error }.
 */
export async function placeQrOrderAction(input: QrOrderInput): Promise<ActionResult<never> | undefined> {
  const r = await run(() => placeQrOrder(sanitize(input)));
  if (!r.ok) return r;
  // Το redirect πετάει (control flow) και πρέπει να καλείται εκτός try/catch.
  redirect(`/order/${r.data.token}`);
}
