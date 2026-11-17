"use client";
import Link from "next/link";
import { useState } from "react";
import { Field } from "@/components/ui";
import { FormModal, formValues, useActionRunner } from "@/components/admin/common";
import { centsToInput, fmtIsoDate } from "@/components/admin/format";
import { monthLabel, shiftMonth } from "@/components/admin/events/dates";
import {
  EXPENSE_CATEGORIES,
  FINANCE_METHOD_LABEL,
  INCOME_CATEGORIES,
  type FinanceEntryRow,
  type FinanceMonth,
  type FinanceYear,
} from "@/components/admin/finance/meta";
import { formatEuro, parseEuroToCents } from "@/server/money";
import type { FinanceKind, FinanceMethod } from "@/db/schema";
import { deleteFinanceEntryAction, saveFinanceEntryAction } from "./actions";

const eur = (c: number) => formatEuro(c);
const SHORT_MONTHS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αύγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

type Modal = { kind: FinanceKind; entry?: FinanceEntryRow } | null;

export function FinanceView({ data, year, today, suppliers }: { data: FinanceMonth; year: FinanceYear; today: string; suppliers: { id: number; name: string }[] }) {
  const runner = useActionRunner();
  const { run, pending, toastElement } = runner;
  const [modal, setModal] = useState<Modal>(null);
  const [seq, setSeq] = useState(0);
  const open = (m: Modal) => {
    setSeq((n) => n + 1);
    setModal(m);
  };
  const { income, expense, net } = data;
  const margin = income.total ? Math.round((net / income.total) * 100) : 0;
  const prev = shiftMonth(data.month, -1);
  const next = shiftMonth(data.month, 1);

  const remove = (e: FinanceEntryRow) => {
    if (!window.confirm(`Διαγραφή: ${e.category} ${eur(e.amountCents)} (${fmtIsoDate(e.date)});`)) return;
    run(() => deleteFinanceEntryAction(e.id), { success: "Η κίνηση διαγράφηκε" });
  };

  const incomeRows = [
    { label: "Ταμείο · μετρητά", cents: income.pos.cash },
    { label: "Ταμείο · κάρτα", cents: income.pos.card },
    ...(income.pos.other ? [{ label: "Ταμείο · άλλο", cents: income.pos.other }] : []),
    ...income.manual.map((m) => ({ label: m.category, cents: m.cents })),
  ];
  const expenseRows = [...(expense.purchases ? [{ label: "Αγορές αποθήκης (παραλαβές)", cents: expense.purchases }] : []), ...expense.manual.map((m) => ({ label: m.category, cents: m.cents }))].sort(
    (a, b) => b.cents - a.cents,
  );

  return (
    <div className="glass-page space-y-4">
      {toastElement}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="glass-label">Οικονομικά</div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Έσοδα – Έξοδα</h1>
          <div className="mt-1 flex items-center gap-2">
            <Link href={{ query: { m: prev } }} className="glass-btn px-2.5 py-1" aria-label="Προηγούμενος μήνας">
              ‹
            </Link>
            <span className="font-medium min-w-36 text-center">{monthLabel(data.month)}</span>
            <Link href={{ query: { m: next } }} className="glass-btn px-2.5 py-1" aria-label="Επόμενος μήνας">
              ›
            </Link>
            {!today.startsWith(data.month) && (
              <Link href={{ query: { m: today.slice(0, 7) } }} className="text-sm text-white/70 hover:text-white underline-offset-4 hover:underline">
                Τρέχων μήνας
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="glass-btn" onClick={() => downloadCsv(data)}>
            ⬇ CSV για λογιστή
          </button>
          <button className="glass-btn" onClick={() => open({ kind: "income" })}>
            + Έσοδο
          </button>
          <button className="glass-btn-solid" onClick={() => open({ kind: "expense" })}>
            + Έξοδο
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Έσοδα" value={income.total} tone="in" sub={`Ταμείο ${eur(income.posTotal)} · λοιπά ${eur(income.manualTotal)}`} />
        <Kpi label="Έξοδα" value={expense.total} tone="out" sub={`Αγορές ${eur(expense.purchases)} · λοιπά ${eur(expense.manualTotal)}`} />
        <Kpi label={net >= 0 ? "Κέρδος" : "Ζημιά"} value={net} tone={net >= 0 ? "in" : "out"} sub={income.total ? `Περιθώριο ${margin}%` : "Χωρίς έσοδα ακόμη"} hi />
      </div>

      <div className="glass p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="glass-label">Ανά ημέρα</div>
          <Legend />
        </div>
        <DayChart days={data.days} today={today} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Breakdown title="Από πού ήρθαν τα έσοδα" rows={incomeRows} total={income.total} tone="in" empty="Δεν υπάρχουν έσοδα αυτόν τον μήνα." />
        <Breakdown title="Πού πήγαν τα έξοδα" rows={expenseRows} total={expense.total} tone="out" empty="Δεν υπάρχουν έξοδα αυτόν τον μήνα." />
      </div>

      <div className="glass p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="glass-label">Τελευταίοι 12 μήνες</div>
          <Legend />
        </div>
        <YearChart year={year} current={data.month} />
      </div>

      <div className="glass overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <div>
            <div className="glass-label">Κινήσεις μήνα</div>
            <div className="text-xs text-white/55 mt-1">
              Οι πληρωμές του ταμείου και οι παραλαβές της αποθήκης μετριούνται αυτόματα — μην τις ξαναπεράσεις εδώ.
            </div>
          </div>
        </div>
        <div className="overflow-x-auto mt-2">
          <table className="glass-table w-full text-sm min-w-[640px]">
            <thead>
              <tr>
                <th>Ημ/νία</th>
                <th>Κατηγορία</th>
                <th>Περιγραφή</th>
                <th>Τρόπος</th>
                <th className="text-right">Ποσό</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="hover:bg-white/[0.04]">
                  <td className="num whitespace-nowrap">{fmtIsoDate(e.date)}</td>
                  <td>
                    <span className={`inline-block h-2 w-2 rounded-full mr-2 ${e.kind === "income" ? "bg-emerald-300" : "bg-rose-300"}`} />
                    {e.category}
                  </td>
                  <td className="text-white/75">
                    {e.description}
                    {e.supplierName && <span className="text-white/50"> · {e.supplierName}</span>}
                    {e.eventTitle && <span className="text-white/50"> · {e.eventTitle}</span>}
                    {e.docNumber && <span className="text-white/50 num"> · #{e.docNumber}</span>}
                  </td>
                  <td className="text-white/70">{FINANCE_METHOD_LABEL[e.method]}</td>
                  <td className={`text-right num font-semibold whitespace-nowrap ${e.kind === "income" ? "text-emerald-300" : "text-rose-300"}`}>
                    {e.kind === "income" ? "+" : "−"}
                    {eur(e.amountCents)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="text-white/70 hover:text-white text-xs px-2" onClick={() => open({ kind: e.kind, entry: e })} disabled={pending}>
                      Επεξεργασία
                    </button>
                    <button className="text-rose-300 hover:text-rose-200 text-xs px-2" onClick={() => remove(e)} disabled={pending}>
                      Διαγραφή
                    </button>
                  </td>
                </tr>
              ))}
              {data.receipts.map((r) => (
                <tr key={`r${r.id}`} className="text-white/60">
                  <td className="num whitespace-nowrap">{fmtIsoDate(r.date)}</td>
                  <td>
                    <span className="inline-block h-2 w-2 rounded-full mr-2 bg-rose-300/50" />
                    Αγορές αποθήκης
                  </td>
                  <td>
                    Παραλαβή{r.supplier ? ` · ${r.supplier}` : ""}
                    {r.docNumber && <span className="num"> · #{r.docNumber}</span>} <span className="text-[10px] uppercase tracking-wider">αυτόματο</span>
                  </td>
                  <td>—</td>
                  <td className="text-right num whitespace-nowrap">−{eur(r.cents)}</td>
                  <td />
                </tr>
              ))}
              {!data.entries.length && !data.receipts.length && (
                <tr>
                  <td colSpan={6} className="text-center text-white/55 py-6">
                    Δεν έχουν περαστεί κινήσεις. Ξεκίνα με τα πάγια: ενοίκιο, ρεύμα, μισθοδοσία.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EntryForm
        key={seq}
        modal={modal}
        onClose={() => setModal(null)}
        suppliers={suppliers}
        defaultDate={today.startsWith(data.month) ? today : `${data.month}-01`}
        runner={runner}
      />
    </div>
  );
}

function Kpi({ label, value, sub, tone, hi }: { label: string; value: number; sub: string; tone: "in" | "out"; hi?: boolean }) {
  return (
    <div className={`${hi ? "glass-hi" : "glass"} p-4`}>
      <div className="glass-label">{label}</div>
      <div className={`mt-1 text-3xl font-semibold num tracking-tight ${tone === "in" ? "text-emerald-200" : "text-rose-200"}`}>{eur(value)}</div>
      <div className="mt-1 text-xs text-white/60">{sub}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-3 text-xs text-white/70">
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-emerald-300" /> Έσοδα
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-rose-300" /> Έξοδα
      </span>
    </div>
  );
}

function Breakdown({ title, rows, total, tone, empty }: { title: string; rows: { label: string; cents: number }[]; total: number; tone: "in" | "out"; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const live = rows.filter((r) => r.cents > 0);
  return (
    <div className="glass p-4">
      <div className="glass-label mb-3">{title}</div>
      {live.length ? (
        <ul className="space-y-2.5">
          {live.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{r.label}</span>
                <span className="num font-medium">
                  {eur(r.cents)} <span className="text-white/45 text-xs">{total ? Math.round((r.cents / total) * 100) : 0}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className={`h-full rounded-full ${tone === "in" ? "bg-gradient-to-r from-emerald-400 to-teal-200" : "bg-gradient-to-r from-rose-400 to-amber-200"}`} style={{ width: `${(r.cents / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-white/55">{empty}</div>
      )}
    </div>
  );
}

function DayChart({ days, today }: { days: FinanceMonth["days"]; today: string }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.income, d.expense)));
  return (
    <div className="flex items-end gap-[3px] h-36" role="img" aria-label="Έσοδα και έξοδα ανά ημέρα">
      {days.map((d) => (
        <div key={d.date} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group" title={`${fmtIsoDate(d.date)} · έσοδα ${eur(d.income)} · έξοδα ${eur(d.expense)}`}>
          <div className="w-full flex items-end justify-center gap-[1px] flex-1">
            <div className="w-1/2 rounded-t bg-emerald-300/80 group-hover:bg-emerald-200" style={{ height: `${(d.income / max) * 100}%` }} />
            <div className="w-1/2 rounded-t bg-rose-300/70 group-hover:bg-rose-200" style={{ height: `${(d.expense / max) * 100}%` }} />
          </div>
          <div className={`mt-1 text-[9px] num ${d.date === today ? "text-white font-bold" : "text-white/40"}`}>{Number(d.date.slice(8))}</div>
        </div>
      ))}
    </div>
  );
}

function YearChart({ year, current }: { year: FinanceYear; current: string }) {
  const max = Math.max(1, ...year.map((m) => Math.max(m.income, m.expense)));
  return (
    <div className="grid grid-cols-12 gap-1.5 sm:gap-3 items-end h-40">
      {year.map((m) => {
        const net = m.income - m.expense;
        return (
          <div key={m.month} className="flex flex-col items-center h-full" title={`${monthLabel(m.month)} · έσοδα ${eur(m.income)} · έξοδα ${eur(m.expense)} · αποτέλεσμα ${eur(net)}`}>
            <div className="w-full flex-1 flex items-end justify-center gap-[2px]">
              <div className="w-1/2 max-w-4 rounded-t bg-emerald-300/80" style={{ height: `${(m.income / max) * 100}%` }} />
              <div className="w-1/2 max-w-4 rounded-t bg-rose-300/70" style={{ height: `${(m.expense / max) * 100}%` }} />
            </div>
            <div className={`mt-1 text-[10px] ${m.month === current ? "text-white font-bold" : "text-white/45"}`}>{SHORT_MONTHS[Number(m.month.slice(5)) - 1]}</div>
            <div className={`text-[9px] num ${net > 0 ? "text-emerald-300" : net < 0 ? "text-rose-300" : "text-white/30"}`}>{net ? `${net > 0 ? "+" : "−"}${Math.round(Math.abs(net) / 100)}` : "·"}</div>
          </div>
        );
      })}
    </div>
  );
}

function EntryForm({
  modal,
  onClose,
  suppliers,
  defaultDate,
  runner,
}: {
  modal: Modal;
  onClose: () => void;
  suppliers: { id: number; name: string }[];
  defaultDate: string;
  runner: ReturnType<typeof useActionRunner>;
}) {
  const [kind, setKind] = useState<FinanceKind>(modal?.kind ?? "expense");
  const [amount, setAmount] = useState(modal?.entry ? centsToInput(modal.entry.amountCents) : "");
  const [vat, setVat] = useState(modal?.entry ? centsToInput(modal.entry.vatCents) : "");
  const e = modal?.entry;
  const cats = kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const vatFrom = (rate: number) => {
    try {
      const gross = parseEuroToCents(amount || "0");
      setVat(centsToInput(Math.round(gross - gross / (1 + rate / 100))));
    } catch {
      /* ποσό όχι έγκυρο ακόμη */
    }
  };

  function submit(fd: FormData) {
    const v = formValues(fd);
    let amountCents = 0;
    let vatCents = 0;
    try {
      amountCents = parseEuroToCents(amount || "0");
      vatCents = parseEuroToCents(vat || "0");
    } catch (err) {
      runner.toast(err instanceof Error ? err.message : "Μη έγκυρο ποσό", "danger");
      return;
    }
    runner.run(
      () =>
        saveFinanceEntryAction({
          id: e?.id,
          kind,
          date: v.str("date"),
          category: v.str("category"),
          description: v.str("description"),
          amountCents,
          vatCents,
          method: v.str("method") as FinanceMethod,
          supplierId: kind === "expense" ? v.intOrNull("supplierId") : null,
          docNumber: v.strOrNull("docNumber"),
        }),
      { success: e ? "Η κίνηση ενημερώθηκε" : kind === "income" ? "Το έσοδο καταχωρήθηκε" : "Το έξοδο καταχωρήθηκε", onSuccess: onClose },
    );
  }

  return (
    <FormModal open={modal !== null} onClose={onClose} title={e ? "Επεξεργασία κίνησης" : kind === "income" ? "Νέο έσοδο" : "Νέο έξοδο"} onSubmit={submit} pending={runner.pending}>
      <div className="grid grid-cols-2 gap-2">
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${kind === k ? (k === "income" ? "bg-ok-soft border-ok text-ok" : "bg-danger-soft border-danger text-danger") : "border-line text-ink-2"}`}
          >
            {k === "income" ? "Έσοδο" : "Έξοδο"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Ημερομηνία">
          <input name="date" type="date" className="input num" required defaultValue={e?.date ?? defaultDate} />
        </Field>
        <Field label="Κατηγορία">
          <select name="category" className="input" defaultValue={e && (cats as readonly string[]).includes(e.category) ? e.category : cats[0]} key={kind}>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Ποσό με ΦΠΑ (€)">
          <input inputMode="decimal" className="input num" required value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0,00" autoFocus />
        </Field>
        <Field label="Από αυτά ΦΠΑ (€)" hint="Προαιρετικό, για τον λογιστή">
          <div className="flex gap-1.5">
            <input inputMode="decimal" className="input num" value={vat} onChange={(ev) => setVat(ev.target.value)} placeholder="0,00" />
            {[24, 13].map((r) => (
              <button key={r} type="button" className="btn-secondary btn-sm shrink-0" onClick={() => vatFrom(r)}>
                {r}%
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Τρόπος πληρωμής">
          <select name="method" className="input" defaultValue={e?.method ?? "bank"}>
            {(Object.keys(FINANCE_METHOD_LABEL) as FinanceMethod[]).map((m) => (
              <option key={m} value={m}>
                {FINANCE_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Αρ. παραστατικού">
          <input name="docNumber" className="input num" defaultValue={e?.docNumber ?? ""} placeholder="π.χ. ΤΔΑ 1532" />
        </Field>
      </div>
      {kind === "expense" && suppliers.length > 0 && (
        <Field label="Προμηθευτής">
          <select name="supplierId" className="input" defaultValue="">
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Περιγραφή">
        <input name="description" className="input" defaultValue={e?.description ?? ""} placeholder={kind === "income" ? "π.χ. Προκαταβολή γάμου Παπαδόπουλου" : "π.χ. Ενοίκιο Νοεμβρίου"} />
      </Field>
    </FormModal>
  );
}

/** CSV (;) με ελληνικά δεκαδικά, ανοίγει σωστά στο Excel. */
function downloadCsv(d: FinanceMonth) {
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows: string[][] = [["Ημερομηνία", "Τύπος", "Κατηγορία", "Περιγραφή", "Τρόπος", "Παραστατικό", "Ποσό", "ΦΠΑ"]];
  for (const day of d.days) {
    const pos = dayPos(d, day.date);
    if (pos > 0) rows.push([day.date, "Έσοδο", "Ταμείο (ημέρας)", "", "", "", money(pos), ""]);
  }
  for (const r of d.receipts) rows.push([r.date, "Έξοδο", "Αγορές αποθήκης", r.supplier ?? "", "", r.docNumber ?? "", money(r.cents), ""]);
  for (const e of d.entries)
    rows.push([e.date, e.kind === "income" ? "Έσοδο" : "Έξοδο", e.category, [e.description, e.supplierName, e.eventTitle].filter(Boolean).join(" · "), FINANCE_METHOD_LABEL[e.method], e.docNumber ?? "", money(e.amountCents), money(e.vatCents)]);
  const csv = "﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `nido-esoda-exoda-${d.month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Έσοδα ταμείου μιας ημέρας = σύνολο ημέρας − χειροκίνητα έσοδα της ίδιας ημέρας. */
function dayPos(d: FinanceMonth, date: string) {
  const day = d.days.find((x) => x.date === date);
  const manual = d.entries.filter((e) => e.kind === "income" && e.date === date).reduce((a, e) => a + e.amountCents, 0);
  return (day?.income ?? 0) - manual;
}
