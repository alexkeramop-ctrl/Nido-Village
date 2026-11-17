/** Κατηγορίες και ετικέτες εσόδων/εξόδων (κοινές για server και client). */
import type { FinanceKind, FinanceMethod } from "@/db/schema";

export const EXPENSE_CATEGORIES = [
  "Ενοίκιο",
  "Μισθοδοσία & ΕΦΚΑ",
  "Ρεύμα",
  "Νερό",
  "Τηλέφωνο & internet",
  "Πρώτες ύλες & ποτά (εκτός αποθήκης)",
  "Αναλώσιμα & καθαριότητα",
  "Συντήρηση & επισκευές",
  "Εξοπλισμός",
  "Διαφήμιση & social",
  "Λογιστής & νομικά",
  "Ασφάλειες",
  "Φόροι & τέλη",
  "Τράπεζα & POS προμήθειες",
  "Άλλο",
] as const;

export const INCOME_CATEGORIES = [
  "Προκαταβολή εκδήλωσης",
  "Εξόφληση εκδήλωσης",
  "Σχολεία & ομάδες",
  "Χορηγίες",
  "Άλλο",
] as const;

export const FINANCE_METHOD_LABEL: Record<FinanceMethod, string> = {
  cash: "Μετρητά",
  card: "Κάρτα",
  bank: "Τράπεζα",
  other: "Άλλο",
};

export const FINANCE_KIND_LABEL: Record<FinanceKind, string> = { income: "Έσοδο", expense: "Έξοδο" };

export type FinanceEntryRow = {
  id: number;
  kind: FinanceKind;
  date: string;
  category: string;
  description: string;
  amountCents: number;
  vatCents: number;
  method: FinanceMethod;
  docNumber: string | null;
  supplierName: string | null;
  eventTitle: string | null;
};

export type FinanceMonth = {
  month: string;
  income: { pos: Record<"cash" | "card" | "other", number>; posTotal: number; manual: { category: string; cents: number }[]; manualTotal: number; total: number };
  expense: { purchases: number; manual: { category: string; cents: number }[]; manualTotal: number; total: number };
  net: number;
  days: { date: string; income: number; expense: number }[];
  entries: FinanceEntryRow[];
  receipts: { id: number; date: string; supplier: string | null; docNumber: string | null; cents: number }[];
};

export type FinanceYear = { month: string; income: number; expense: number }[];
