/** Ετικέτες για την κατάσταση παραγγελίας QR. Ασφαλές για client. */
import type { PublicOrderStatus } from "@/server/services/public-order";

export const QR_STATUS_LABEL: Record<PublicOrderStatus, string> = {
  received: "Ελήφθη",
  preparing: "Ετοιμάζεται",
  ready: "Έτοιμη για παραλαβή",
  picked_up: "Παραδόθηκε",
  done: "Ολοκληρώθηκε",
  cancelled: "Ακυρώθηκε",
};

export const QR_STATUS_TONE: Record<PublicOrderStatus, "neutral" | "ok" | "warn" | "danger" | "brand"> = {
  received: "neutral",
  preparing: "warn",
  ready: "ok",
  picked_up: "brand",
  done: "brand",
  cancelled: "danger",
};

/** Το πρώτο όνομα του πελάτη (για τον πίνακα παραλαβών και τη σελίδα κατάστασης). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
