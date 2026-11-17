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
  /** Καθαρή αξία· null στις παλιές κινήσεις. */
  netCents: number | null;
  method: FinanceMethod;
  docNumber: string | null;
  supplierId: number | null;
  supplierName: string | null;
  supplierAfm: string | null;
  eventTitle: string | null;
  /** false = οφείλεται. */
  paid: boolean;
  dueDate: string | null;
  paidAt: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  /** Υπάρχει αρχείο στο Drive που μπορεί να πάει στον κάδο μαζί με την κίνηση. */
  hasDriveFile: boolean;
};

/** Οφειλές σε προμηθευτές: όλα τα απλήρωτα τιμολόγια, ανεξάρτητα από μήνα. */
export type UnpaidSummary = {
  totalCents: number;
  count: number;
  overdueCents: number;
  overdueCount: number;
  entries: FinanceEntryRow[];
};

/** Τι είναι διαθέσιμο στη φόρμα τιμολογίου (ανάλογα με τις ρυθμίσεις του server). */
export type InvoiceFeatures = {
  /** Κλειδιά Google ορισμένα ΚΑΙ συνδεδεμένος λογαριασμός: τα αρχεία ανεβαίνουν στο Drive. */
  drive: boolean;
  /** Η σύνδεση υπάρχει αλλά η Google την απέρριψε (χρειάζεται επανασύνδεση). */
  driveNeedsReconnect: boolean;
  /** Ορισμένο ANTHROPIC_API_KEY: εμφανίζεται το «Ανάγνωση τιμολογίου». */
  ai: boolean;
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
