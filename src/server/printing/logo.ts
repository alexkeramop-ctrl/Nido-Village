/** Το λογότυπο ως ασπρόμαυρο bitmap για θερμικούς εκτυπωτές (384 dots πλάτος). */
import bitmap from "./assets/logo-bitmap.json";

export type TicketImage = { width: number; height: number; data: string; label?: string };

export function logoImage(): TicketImage {
  return { width: bitmap.width, height: bitmap.height, data: bitmap.data, label: "ΛΟΓΟΤΥΠΟ" };
}
