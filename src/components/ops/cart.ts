/** Το καλάθι όπως το κρατά η οθόνη (PDA σερβιτόρου και ταμείο). Καθαρές συναρτήσεις, ασφαλείς για client. */
import type { CartLine } from "@/server/services/ordering";

export type UiLine = {
  key: string;
  productId: number;
  name: string;
  unitPriceCents: number;
  qty: number;
  course: number;
  notes: string;
  modifiers: { id: number; name: string; priceDeltaCents: number }[];
};

export const lineTotal = (l: UiLine) => (l.unitPriceCents + l.modifiers.reduce((n, m) => n + m.priceDeltaCents, 0)) * l.qty;
export const cartTotal = (cart: UiLine[]) => cart.reduce((n, l) => n + lineTotal(l), 0);
export const cartCount = (cart: UiLine[]) => cart.reduce((n, l) => n + l.qty, 0);
export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Προσθήκη γραμμής: ίδιο είδος χωρίς επιλογές/σημείωση (και ίδιο πιάτο) αυξάνει την ποσότητα αντί για νέα γραμμή. */
export function addLine(prev: UiLine[], line: Omit<UiLine, "key">): UiLine[] {
  if (!line.modifiers.length && !line.notes) {
    const idx = prev.findIndex((l) => l.productId === line.productId && !l.modifiers.length && !l.notes && l.course === line.course);
    if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + line.qty } : l));
  }
  return [...prev, { ...line, key: newKey() }];
}

/** Η μορφή που στέλνεται στον server. */
export function toCartLines(cart: UiLine[]): CartLine[] {
  return cart.map((l) => ({ productId: l.productId, qty: l.qty, course: l.course, notes: l.notes || null, modifierIds: l.modifiers.map((m) => m.id) }));
}
