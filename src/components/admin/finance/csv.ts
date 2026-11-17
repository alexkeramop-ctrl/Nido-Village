/** CSV (;) με ελληνικά δεκαδικά για τον λογιστή — ανοίγει σωστά στο Excel. Καθαρή συνάρτηση (ελέγχεται σε test). */
import { FINANCE_METHOD_LABEL, type FinanceMonth } from "./meta";

export const FINANCE_CSV_HEADER = [
  "Ημερομηνία",
  "Τύπος",
  "Κατηγορία",
  "Περιγραφή",
  "Τρόπος",
  "Παραστατικό",
  "Ποσό",
  "ΦΠΑ",
  // Στήλες τιμολογίων προμηθευτών
  "Καθαρό",
  "Προμηθευτής",
  "ΑΦΜ προμηθευτή",
  "Κατάσταση",
  "Λήξη πληρωμής",
  "Ημ/νία πληρωμής",
  "Αρχείο",
];

const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** Έσοδα ταμείου μιας ημέρας = σύνολο ημέρας − χειροκίνητα έσοδα της ίδιας ημέρας. */
function dayPos(d: FinanceMonth, date: string) {
  const day = d.days.find((x) => x.date === date);
  const manual = d.entries.filter((e) => e.kind === "income" && e.date === date).reduce((a, e) => a + e.amountCents, 0);
  return (day?.income ?? 0) - manual;
}

export function financeCsvRows(d: FinanceMonth): string[][] {
  const rows: string[][] = [FINANCE_CSV_HEADER];
  const pad = (r: string[]) => [...r, ...Array<string>(FINANCE_CSV_HEADER.length - r.length).fill("")];
  for (const day of d.days) {
    const pos = dayPos(d, day.date);
    if (pos > 0) rows.push(pad([day.date, "Έσοδο", "Ταμείο (ημέρας)", "", "", "", money(pos), ""]));
  }
  for (const r of d.receipts) rows.push(pad([r.date, "Έξοδο", "Αγορές αποθήκης", r.supplier ?? "", "", r.docNumber ?? "", money(r.cents), "", "", r.supplier ?? ""]));
  for (const e of d.entries) {
    const expense = e.kind === "expense";
    rows.push([
      e.date,
      expense ? "Έξοδο" : "Έσοδο",
      e.category,
      [e.description, e.supplierName, e.eventTitle].filter(Boolean).join(" · "),
      FINANCE_METHOD_LABEL[e.method],
      e.docNumber ?? "",
      money(e.amountCents),
      money(e.vatCents),
      e.netCents !== null ? money(e.netCents) : "",
      e.supplierName ?? "",
      e.supplierAfm ?? "",
      expense ? (e.paid ? "Πληρωμένο" : "Οφείλεται") : "",
      e.dueDate ?? "",
      expense && e.paid ? (e.paidAt ?? e.date) : "",
      e.attachmentUrl ?? "",
    ]);
  }
  return rows;
}

export function financeCsv(d: FinanceMonth): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return "﻿" + financeCsvRows(d).map((r) => r.map(q).join(";")).join("\r\n");
}
