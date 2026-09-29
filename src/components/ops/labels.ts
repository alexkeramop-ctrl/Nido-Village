/** Ετικέτες και μικρά βοηθητικά για τις οθόνες λειτουργίας (PDA, KDS, ταμείο). Ασφαλές για client. */
import type { ItemStatus, OrderType, PaymentMethod, SessionStatus } from "@/db/schema";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "brand";

export const ORDER_TYPE_LABEL: Record<OrderType, string> = { dine_in: "ΤΡΑΠΕΖΙ", takeaway: "ΠΑΚΕΤΟ", delivery: "DELIVERY" };
export const ORDER_TYPE_TITLE: Record<OrderType, string> = { dine_in: "Τραπέζι", takeaway: "Πακέτο", delivery: "Delivery" };

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  sent: "Στάλθηκε",
  preparing: "Ετοιμάζεται",
  ready: "Έτοιμο",
  served: "Σερβιρίστηκε",
  voided: "Ακυρώθηκε",
};
export const ITEM_STATUS_TONE: Record<ItemStatus, Tone> = { sent: "neutral", preparing: "warn", ready: "ok", served: "brand", voided: "danger" };

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = { open: "Ανοιχτό", billed: "Λογαριασμός", closed: "Κλειστό", cancelled: "Ακυρώθηκε" };
export const SESSION_STATUS_TONE: Record<SessionStatus, Tone> = { open: "brand", billed: "warn", closed: "neutral", cancelled: "danger" };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Μετρητά", card: "Κάρτα", other: "Άλλο" };

export const VOID_REASONS = ["Λάθος παραγγελία", "Πελάτης άλλαξε γνώμη", "Δεν βγήκε σωστά"];
export const DISCOUNT_REASONS = ["Κέρασμα", "Παράπονο πελάτη", "Προσωπικό", "Προσφορά"];

const ATHENS = "Europe/Athens";

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ATHENS });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("el-GR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ATHENS,
  });
}

export function courseLabel(course: number): string {
  return `${course}ο πιάτο`;
}

/** "12,50" για input πεδία (χωρίς σύμβολο ευρώ). */
export function centsToInput(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2).replace(".", ",");
}

/** mm:ss από χιλιοστά. */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Λεπτά που πέρασαν από μια χρονική στιγμή (Date ή ISO string). */
export function minutesSince(from: Date | string, now: number = Date.now()): number {
  const t = typeof from === "string" ? new Date(from).getTime() : from.getTime();
  return Math.max(0, Math.floor((now - t) / 60000));
}
