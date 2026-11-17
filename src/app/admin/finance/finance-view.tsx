"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Field, Modal } from "@/components/ui";
import { FormModal, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { fmtIsoDate } from "@/components/admin/format";
import { monthLabel, shiftMonth } from "@/components/admin/events/dates";
import { FINANCE_METHOD_LABEL, type FinanceEntryRow, type FinanceMonth, type FinanceYear, type InvoiceFeatures, type UnpaidSummary } from "@/components/admin/finance/meta";
import { financeCsv } from "@/components/admin/finance/csv";
import { formatEuro } from "@/server/money";
import type { FinanceMethod } from "@/db/schema";
import { DateGR } from "@/components/admin/date-gr";
import { deleteFinanceEntryAction, markFinanceEntryPaidAction } from "./actions";
import { EntryForm, type EntryModal, type SupplierOption } from "./entry-form";

const eur = (c: number) => formatEuro(c);
const SHORT_MONTHS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αύγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

export function FinanceView({
  data,
  year,
  today,
  suppliers,
  unpaid,
  features,
}: {
  data: FinanceMonth;
  year: FinanceYear;
  today: string;
  suppliers: SupplierOption[];
  unpaid: UnpaidSummary;
  features: InvoiceFeatures;
}) {
  const runner = useActionRunner();
  const { run, pending, toastElement } = runner;
  const [modal, setModal] = useState<EntryModal>(null);
  const [seq, setSeq] = useState(0);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [paying, setPaying] = useState<FinanceEntryRow | null>(null);
  const [deleting, setDeleting] = useState<FinanceEntryRow | null>(null);
  const [trashFile, setTrashFile] = useState(false);
  const open = (m: EntryModal) => {
    setSeq((n) => n + 1);
    setModal(m);
  };
  const { income, expense, net } = data;
  const margin = income.total ? Math.round((net / income.total) * 100) : 0;
  const prev = shiftMonth(data.month, -1);
  const next = shiftMonth(data.month, 1);
  /** «Μόνο απλήρωτα»: όλα τα τιμολόγια που οφείλονται, από όλους τους μήνες. */
  const rows = onlyUnpaid ? unpaid.entries : data.entries;

  const askDelete = (e: FinanceEntryRow) => {
    setTrashFile(false);
    setDeleting(e);
  };
  const confirmDelete = () => {
    const e = deleting;
    if (!e) return;
    run(() => deleteFinanceEntryAction(e.id, { trashFile: trashFile && e.hasDriveFile }), {
      onSuccess: (r) => {
        setDeleting(null);
        if (r.warning) runner.toast(r.warning, "danger");
        else runner.toast(trashFile && e.hasDriveFile ? "Η κίνηση διαγράφηκε και το αρχείο πήγε στον κάδο του Drive" : "Η κίνηση διαγράφηκε");
      },
    });
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
              <Link href={{ query: { m: today.slice(0, 7) } }} className="text-sm text-ink-2 hover:text-ink underline-offset-4 hover:underline">
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
            + Τιμολόγιο / έξοδο
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Έσοδα" value={income.total} tone="in" sub={`Ταμείο ${eur(income.posTotal)} · λοιπά ${eur(income.manualTotal)}`} />
        <Kpi label="Έξοδα" value={expense.total} tone="out" sub={`Αγορές ${eur(expense.purchases)} · λοιπά ${eur(expense.manualTotal)}`} />
        <Kpi label={net >= 0 ? "Κέρδος" : "Ζημιά"} value={net} tone={net >= 0 ? "in" : "out"} sub={income.total ? `Περιθώριο ${margin}%` : "Χωρίς έσοδα ακόμη"} hi />
      </div>
      <p className="text-xs text-ink-3 -mt-2 px-1" data-testid="accrual-note">
        Το αποτέλεσμα του μήνα μετρά κάθε τιμολόγιο στην <strong>ημερομηνία του παραστατικού</strong>, όχι της πληρωμής: ένα τιμολόγιο που οφείλεται είναι ήδη έξοδο του μήνα του.
      </p>

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
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <div className="glass-label">{onlyUnpaid ? "Απλήρωτα τιμολόγια · όλοι οι μήνες" : "Κινήσεις μήνα"}</div>
            <div className="text-xs text-ink-3 mt-1">
              Οι πληρωμές του ταμείου και οι παραλαβές της αποθήκης μετριούνται αυτόματα — μην τις ξαναπεράσεις εδώ.
            </div>
          </div>
          <Toggle label="Μόνο απλήρωτα" checked={onlyUnpaid} onChange={setOnlyUnpaid} />
        </div>
        <div className={`mx-4 mt-3 rounded-xl px-3 py-2 text-sm ${unpaid.count ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2"}`} data-testid="unpaid-summary">
          {unpaid.count ? (
            <>
              Οφειλές σε προμηθευτές: <strong className="num">{eur(unpaid.totalCents)}</strong> σε {unpaid.count} {unpaid.count === 1 ? "τιμολόγιο" : "τιμολόγια"}
              {unpaid.overdueCount > 0 && (
                <span className="text-danger">
                  {" "}
                  · ληξιπρόθεσμα <strong className="num">{eur(unpaid.overdueCents)}</strong> ({unpaid.overdueCount})
                </span>
              )}
            </>
          ) : (
            "Οφειλές σε προμηθευτές: καμία — όλα τα τιμολόγια είναι πληρωμένα."
          )}
        </div>
        <div className="overflow-x-auto mt-2">
          <table className="glass-table w-full text-sm min-w-[820px]">
            <thead>
              <tr>
                <th>Ημ/νία</th>
                <th>Κατηγορία</th>
                <th>Προμηθευτής · περιγραφή</th>
                <th>Παραστατικό</th>
                <th>Πληρωμή</th>
                <th className="text-right">Ποσό</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const overdue = !e.paid && e.dueDate !== null && e.dueDate < today;
                return (
                  <tr key={e.id} className="hover:bg-white/50">
                    <td className="num whitespace-nowrap">{fmtIsoDate(e.date)}</td>
                    <td>
                      <span className={`inline-block h-2 w-2 rounded-full mr-2 ${e.kind === "income" ? "bg-emerald-300" : "bg-rose-400"}`} />
                      {e.category}
                    </td>
                    <td className="text-ink-2">
                      {e.supplierName && <span className="font-medium text-ink">{e.supplierName}</span>}
                      {e.supplierName && (e.description || e.eventTitle) ? " · " : ""}
                      {e.description}
                      {e.eventTitle && <span className="text-ink-3"> · {e.eventTitle}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {e.docNumber && <span className="num text-ink-2">#{e.docNumber}</span>}
                      {e.attachmentUrl && (
                        <a
                          href={e.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white"
                          title={`Άνοιγμα αρχείου: ${e.attachmentName ?? "συνημμένο"}`}
                          aria-label={`Άνοιγμα αρχείου ${e.attachmentName ?? ""}`}
                        >
                          📎
                        </a>
                      )}
                      {!e.docNumber && !e.attachmentUrl && <span className="text-ink-3">—</span>}
                    </td>
                    <td className="text-ink-2">
                      {e.paid ? (
                        <>
                          {FINANCE_METHOD_LABEL[e.method]}
                          {e.paidAt && e.paidAt !== e.date && <div className="text-[11px] text-ink-3 num">πληρ. {fmtIsoDate(e.paidAt)}</div>}
                        </>
                      ) : (
                        <>
                          <Badge tone={overdue ? "danger" : "warn"}>Οφείλεται</Badge>
                          {e.dueDate && <div className={`text-[11px] num mt-0.5 ${overdue ? "text-danger" : "text-ink-3"}`}>{overdue ? "έληξε" : "λήξη"} {fmtIsoDate(e.dueDate)}</div>}
                        </>
                      )}
                    </td>
                    <td className={`text-right num font-semibold whitespace-nowrap ${e.kind === "income" ? "text-emerald-700" : "text-rose-600"}`}>
                      {e.kind === "income" ? "+" : "−"}
                      {eur(e.amountCents)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {!e.paid && (
                        <button className="glass-btn px-2 py-1 text-xs mr-1" onClick={() => setPaying(e)} disabled={pending}>
                          ✓ Σήμανση ως πληρωμένο
                        </button>
                      )}
                      <button className="text-ink-2 hover:text-ink text-xs px-2" onClick={() => open({ kind: e.kind, entry: e })} disabled={pending}>
                        Επεξεργασία
                      </button>
                      <button className="text-rose-600 hover:text-rose-600 text-xs px-2" onClick={() => askDelete(e)} disabled={pending}>
                        Διαγραφή
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!onlyUnpaid &&
                data.receipts.map((r) => (
                  <tr key={`r${r.id}`} className="text-ink-2">
                    <td className="num whitespace-nowrap">{fmtIsoDate(r.date)}</td>
                    <td>
                      <span className="inline-block h-2 w-2 rounded-full mr-2 bg-rose-300/50" />
                      Αγορές αποθήκης
                    </td>
                    <td>
                      Παραλαβή{r.supplier ? ` · ${r.supplier}` : ""} <span className="text-[10px] uppercase tracking-wider">αυτόματο</span>
                    </td>
                    <td>{r.docNumber ? <span className="num">#{r.docNumber}</span> : "—"}</td>
                    <td>—</td>
                    <td className="text-right num whitespace-nowrap">−{eur(r.cents)}</td>
                    <td />
                  </tr>
                ))}
              {onlyUnpaid && !rows.length && (
                <tr>
                  <td colSpan={7} className="text-center text-ink-3 py-6">
                    Δεν υπάρχουν απλήρωτα τιμολόγια.
                  </td>
                </tr>
              )}
              {!onlyUnpaid && !data.entries.length && !data.receipts.length && (
                <tr>
                  <td colSpan={7} className="text-center text-ink-3 py-6">
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
        features={features}
        runner={runner}
      />

      <PayForm key={paying ? `p${paying.id}` : "p"} entry={paying} today={today} onClose={() => setPaying(null)} runner={runner} />

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Διαγραφή κίνησης">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm">
              Να διαγραφεί η κίνηση <strong>{deleting.supplierName ?? deleting.category}</strong> {eur(deleting.amountCents)} της {fmtIsoDate(deleting.date)};
            </p>
            {deleting.hasDriveFile && (
              <div className="rounded-xl bg-surface-3 px-3 py-3 space-y-2">
                <div className="text-sm break-all">📎 {deleting.attachmentName}</div>
                {features.drive ? (
                  <Toggle label="Να πάει και το αρχείο στον κάδο του Google Drive" checked={trashFile} onChange={setTrashFile} />
                ) : (
                  <div className="text-xs text-ink-3">Το Google Drive δεν είναι συνδεδεμένο: το αρχείο θα μείνει στο Drive.</div>
                )}
                {features.drive && <div className="text-xs text-ink-3">{trashFile ? "Το αρχείο μένει 30 ημέρες στον κάδο του Drive πριν σβηστεί οριστικά." : "Το αρχείο θα μείνει στο Google Drive."}</div>}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDeleting(null)} disabled={pending}>
                Άκυρο
              </button>
              <button type="button" className="btn-danger btn-sm" onClick={confirmDelete} disabled={pending}>
                {pending ? "Διαγραφή…" : "Διαγραφή"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** «Σήμανση ως πληρωμένο»: ρωτά τρόπο και ημερομηνία πληρωμής. Η ημερομηνία παραστατικού δεν αλλάζει. */
function PayForm({ entry, today, onClose, runner }: { entry: FinanceEntryRow | null; today: string; onClose: () => void; runner: ReturnType<typeof useActionRunner> }) {
  const [paidAt, setPaidAt] = useState(today);
  return (
    <FormModal
      open={entry !== null}
      onClose={onClose}
      title="Σήμανση ως πληρωμένο"
      submitLabel="Πληρώθηκε"
      pending={runner.pending}
      onSubmit={(fd) => {
        if (!entry) return;
        const method = formValues(fd).str("method") as FinanceMethod;
        runner.run(() => markFinanceEntryPaidAction(entry.id, { method, paidAt }), { success: "Το τιμολόγιο σημειώθηκε ως πληρωμένο", onSuccess: onClose });
      }}
    >
      {entry && (
        <>
          <div className="rounded-xl bg-surface-3 px-3 py-2 text-sm">
            <div className="font-medium">{entry.supplierName ?? entry.category}</div>
            <div className="text-ink-2">
              {entry.docNumber ? `#${entry.docNumber} · ` : ""}
              {fmtIsoDate(entry.date)} · <span className="num font-semibold">{eur(entry.amountCents)}</span>
            </div>
          </div>
          <Field label="Τρόπος πληρωμής">
            <select name="method" className="input" defaultValue={entry.method} autoFocus>
              {(Object.keys(FINANCE_METHOD_LABEL) as FinanceMethod[]).map((m) => (
                <option key={m} value={m}>
                  {FINANCE_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ημ/νία πληρωμής" hint="Το τιμολόγιο μένει στα έξοδα του μήνα που εκδόθηκε.">
            <DateGR value={paidAt} onChange={setPaidAt} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function Kpi({ label, value, sub, tone, hi }: { label: string; value: number; sub: string; tone: "in" | "out"; hi?: boolean }) {
  return (
    <div className={`${hi ? "glass-hi" : "glass"} p-4`}>
      <div className="glass-label">{label}</div>
      <div className={`mt-1 text-3xl font-semibold num tracking-tight ${tone === "in" ? "text-emerald-700" : "text-rose-600"}`}>{eur(value)}</div>
      <div className="mt-1 text-xs text-ink-2">{sub}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-3 text-xs text-ink-2">
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-emerald-300" /> Έσοδα
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-rose-400" /> Έξοδα
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
                  {eur(r.cents)} <span className="text-ink-3 text-xs">{total ? Math.round((r.cents / total) * 100) : 0}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-black/5 overflow-hidden">
                <div className={`h-full rounded-full ${tone === "in" ? "bg-gradient-to-r from-emerald-400 to-teal-200" : "bg-gradient-to-r from-rose-400 to-amber-200"}`} style={{ width: `${(r.cents / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-3">{empty}</div>
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
            <div className="w-1/2 rounded-t bg-emerald-500/80 group-hover:bg-emerald-600" style={{ height: `${(d.income / max) * 100}%` }} />
            <div className="w-1/2 rounded-t bg-rose-400/80 group-hover:bg-rose-500" style={{ height: `${(d.expense / max) * 100}%` }} />
          </div>
          <div className={`mt-1 text-[9px] num ${d.date === today ? "text-ink font-bold" : "text-ink-3"}`}>{Number(d.date.slice(8))}</div>
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
              <div className="w-1/2 max-w-4 rounded-t bg-emerald-500/80" style={{ height: `${(m.income / max) * 100}%` }} />
              <div className="w-1/2 max-w-4 rounded-t bg-rose-400/80" style={{ height: `${(m.expense / max) * 100}%` }} />
            </div>
            <div className={`mt-1 text-[10px] ${m.month === current ? "text-ink font-bold" : "text-ink-3"}`}>{SHORT_MONTHS[Number(m.month.slice(5)) - 1]}</div>
            <div className={`text-[9px] num ${net > 0 ? "text-emerald-700" : net < 0 ? "text-rose-600" : "text-ink-3"}`}>{net ? `${net > 0 ? "+" : "−"}${Math.round(Math.abs(net) / 100)}` : "·"}</div>
          </div>
        );
      })}
    </div>
  );
}

/** CSV (;) με ελληνικά δεκαδικά, ανοίγει σωστά στο Excel. */
function downloadCsv(d: FinanceMonth) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([financeCsv(d)], { type: "text/csv;charset=utf-8" }));
  a.download = `nido-esoda-exoda-${d.month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
