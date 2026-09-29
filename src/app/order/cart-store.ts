/**
 * Μικρό «εξωτερικό store» πάνω από το localStorage για τη δημόσια σελίδα παραγγελίας.
 * Το καλάθι ζει στο localStorage (επιβιώνει σε refresh/κλείσιμο του browser) και τα components το
 * διαβάζουν με useSyncExternalStore: στον server/hydration επιστρέφει null, μετά την πραγματική τιμή.
 * Αν το localStorage δεν είναι διαθέσιμο (private mode, γεμάτος χώρος), κρατάμε την τιμή στη μνήμη.
 */
import { useSyncExternalStore } from "react";

export const CART_KEY = "nido.order.cart";
export const CUSTOMER_KEY = "nido.order.customer";

const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / quota: μένει μόνο στη μνήμη */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function serverSnapshot(): null {
  return null;
}

/** Η αποθηκευμένη τιμή (raw string) ή null. Στον server πάντα null. */
export function useStoredValue(key: string): string | null {
  return useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
}

export function setStoredJson(key: string, value: unknown | null) {
  write(key, value === null ? null : JSON.stringify(value));
}

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
