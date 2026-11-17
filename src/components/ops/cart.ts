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

/** Ό,τι χρειάζεται από τον κατάλογο για να ξανατιμολογηθεί μια γραμμή. */
export type PricedProduct = { id: number; name: string; priceCents: number; modifierGroups: { modifiers: { id: number; name: string; priceDeltaCents: number }[] }[] };

/**
 * Ξανατιμολογεί το καλάθι από φρέσκο κατάλογο (το ταμείο κρατά τον κατάλογο στον browser και τον ξαναφορτώνει όταν αλλάξει).
 * Οι γραμμές παίρνουν τις τρέχουσες τιμές/ονόματα· όσες έχουν είδος ή επιλογή που δεν πωλείται πια αφαιρούνται.
 * Επιστρέφει και τι άλλαξε, ώστε η οθόνη να το πει στον ταμία (το σύνολο αλλάζει κάτω από τα χέρια του).
 */
export function repriceCart(cart: UiLine[], products: Iterable<PricedProduct>): { lines: UiLine[]; repriced: string[]; removed: string[] } {
  const byId = new Map<number, PricedProduct>();
  for (const p of products) byId.set(p.id, p);
  const lines: UiLine[] = [];
  const repriced = new Set<string>();
  const removed = new Set<string>();
  for (const l of cart) {
    const p = byId.get(l.productId);
    const mods = p ? new Map(p.modifierGroups.flatMap((g) => g.modifiers).map((m) => [m.id, m])) : null;
    if (!p || !mods || l.modifiers.some((m) => !mods.has(m.id))) {
      removed.add(l.name);
      continue;
    }
    const next: UiLine = { ...l, name: p.name, unitPriceCents: p.priceCents, modifiers: l.modifiers.map((m) => ({ id: m.id, name: mods.get(m.id)!.name, priceDeltaCents: mods.get(m.id)!.priceDeltaCents })) };
    const same = next.name === l.name && lineTotal(next) === lineTotal(l) && next.modifiers.every((m, i) => m.name === l.modifiers[i].name && m.priceDeltaCents === l.modifiers[i].priceDeltaCents);
    if (lineTotal(next) !== lineTotal(l)) repriced.add(p.name);
    lines.push(same ? l : next);
  }
  return { lines, repriced: [...repriced], removed: [...removed] };
}
