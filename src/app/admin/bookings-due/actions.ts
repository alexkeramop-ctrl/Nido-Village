"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { deleteEventPayment, eventPayments, recordEventPayment, type PaymentInput } from "@/server/services/booking-payments";

/** Οι πληρωμές αλλάζουν τα ημερολόγια, τις οφειλές, την επισκόπηση και τα έσοδα–έξοδα. */
function revalidate() {
  for (const p of ["/admin/events", "/admin/ceremonies", "/admin/parties", "/admin/bookings-due", "/admin/finance", "/admin"]) revalidatePath(p);
}

/** Τιμή, εισπράξεις, υπόλοιπο και λίστα πληρωμών μιας κράτησης. */
export async function eventPaymentsAction(eventId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    return eventPayments(eventId);
  });
}

/** Καταχώρηση πληρωμής (υπεύθυνος ή διαχειριστής). Γράφεται ως έσοδο δεμένο με την κράτηση. */
export async function recordPaymentAction(input: PaymentInput) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    const result = await recordEventPayment(
      { eventId: Number(input.eventId), date: String(input.date), amountCents: Number(input.amountCents), method: input.method, type: input.type, note: input.note ? String(input.note) : null },
      me.id,
    );
    revalidate();
    return result;
  });
}

/** Διαγραφή πληρωμής: μόνο ο διαχειριστής (σβήνει κίνηση εσόδου). */
export async function deletePaymentAction(eventId: number, paymentId: number) {
  return run(async () => {
    const me = await requireRole("admin");
    const summary = await deleteEventPayment(Number(eventId), Number(paymentId), me.id);
    revalidate();
    return summary;
  });
}
