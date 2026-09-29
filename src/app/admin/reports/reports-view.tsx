"use client";
import Link from "next/link";
import { Money, Stat } from "@/components/ui";
import { BarChart } from "@/components/admin/bars";
import { PageHeader, Section, TableWrap } from "@/components/admin/common";
import { fmtDayShort, fmtIsoDate } from "@/components/admin/format";

type Summary = {
  sessions: number;
  grossCents: number;
  discountsCents: number;
  avgTicketCents: number;
  covers: number;
  perCoverCents: number;
  byMethod: Record<string, number>;
  byDay: { day: string; grossCents: number; count: number }[];
  byHour: { hour: number; grossCents: number; count: number }[];
  vat: { ratePct: number; netCents: number; vatCents: number; grossCents: number }[];
  voidsCents: number;
  voidsCount: number;
};
type ProductRow = { productId: number; name: string; category: string; qty: number; grossCents: number; costCents: number; marginCents: number; marginPct: number };
type CategoryRow = { category: string; qty: number; grossCents: number };
type EmployeeRow = { employeeId: number; name: string; grossCents: number; rounds: number; sessions: number };
type Preset = { label: string; from: string; to: string };

const METHOD: Record<string, string> = { cash: "Μετρητά", card: "Κάρτα", other: "Άλλο" };

export function ReportsView({
  from,
  to,
  presets,
  summary: s,
  byProduct,
  byCategory,
  byEmployee,
}: {
  from: string;
  to: string;
  presets: Preset[];
  summary: Summary;
  byProduct: ProductRow[];
  byCategory: CategoryRow[];
  byEmployee: EmployeeRow[];
}) {
  const methodTotal = Object.values(s.byMethod).reduce((n, v) => n + v, 0);
  const rangeLabel = from === to ? fmtIsoDate(from) : `${fmtIsoDate(from)} – ${fmtIsoDate(to)}`;
  const totalCost = byProduct.reduce((n, r) => n + r.costCents, 0);
  const totalQty = byProduct.reduce((n, r) => n + r.qty, 0);

  return (
    <div className="space-y-4 print:space-y-3">
      <style>{`@media print { header, nav, .print\\:hidden { display: none !important; } body { background: #fff; } .card { box-shadow: none; break-inside: avoid; } }`}</style>
      <PageHeader
        title="Αναφορές πωλήσεων"
        subtitle={`Περίοδος: ${rangeLabel} · μόνο κλεισμένοι λογαριασμοί (ώρα Αθήνας)`}
        actions={
          <button className="btn-secondary btn-sm" onClick={() => window.print()}>
            Εκτύπωση
          </button>
        }
      />

      <div className="card p-3 flex flex-wrap items-end gap-2 print:hidden">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = p.from === from && p.to === to;
            return (
              <Link key={p.label} href={{ pathname: "/admin/reports", query: { from: p.from, to: p.to } }} className={`chip ${active ? "bg-brand text-white" : "bg-surface-3 text-ink-2 hover:bg-line"}`}>
                {p.label}
              </Link>
            );
          })}
        </div>
        <form method="get" action="/admin/reports" className="flex flex-wrap items-end gap-2 sm:ml-auto">
          <label className="text-xs text-ink-3">
            Από
            <input type="date" name="from" defaultValue={from} className="input py-1.5 num block" />
          </label>
          <label className="text-xs text-ink-3">
            Έως
            <input type="date" name="to" defaultValue={to} className="input py-1.5 num block" />
          </label>
          <button className="btn-secondary btn-sm">Εμφάνιση</button>
        </form>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Τζίρος" value={<Money cents={s.grossCents} />} sub={`${s.sessions} λογαριασμοί`} />
        <Stat label="Μέση απόδειξη" value={<Money cents={s.avgTicketCents} />} sub="ανά λογαριασμό" />
        <Stat label="Άτομα" value={s.covers} sub={<span>ανά άτομο <Money cents={s.perCoverCents} /></span>} />
        <Stat label="Εκπτώσεις" value={<Money cents={s.discountsCents} />} sub={<span>ακυρώσεις: {s.voidsCount} (<Money cents={s.voidsCents} />)</span>} tone={s.voidsCount ? "warn" : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Τζίρος ανά ημέρα">
          <BarChart data={s.byDay.map((d) => ({ key: d.day, label: fmtDayShort(d.day), value: d.grossCents, sub: `${d.count} λογαριασμοί` }))} emptyText="Δεν υπάρχουν κλεισμένοι λογαριασμοί στην περίοδο" />
        </Section>
        <Section title="Τζίρος ανά ώρα">
          <BarChart data={s.byHour.map((h) => ({ key: String(h.hour), label: `${String(h.hour).padStart(2, "0")}:00`, value: h.grossCents, sub: `${h.count} λογαριασμοί` }))} emptyText="Δεν υπάρχουν κλεισμένοι λογαριασμοί στην περίοδο" />
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Τρόποι πληρωμής" flush>
          <TableWrap>
            <thead>
              <tr>
                <th>Τρόπος</th>
                <th className="text-right">Ποσό</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.byMethod).map(([m, v]) => (
                <tr key={m}>
                  <td>{METHOD[m] ?? m}</td>
                  <td className="text-right">
                    <Money cents={v} />
                  </td>
                  <td className="text-right num text-ink-2">{methodTotal ? Math.round((v / methodTotal) * 100) : 0}%</td>
                </tr>
              ))}
              {!Object.keys(s.byMethod).length && (
                <tr>
                  <td colSpan={3} className="text-ink-3">
                    Καμία πληρωμή
                  </td>
                </tr>
              )}
            </tbody>
          </TableWrap>
        </Section>
        <Section title="ΦΠΑ" flush>
          <TableWrap>
            <thead>
              <tr>
                <th>Συντελεστής</th>
                <th className="text-right">Καθαρή αξία</th>
                <th className="text-right">ΦΠΑ</th>
                <th className="text-right">Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              {s.vat.map((v) => (
                <tr key={v.ratePct}>
                  <td className="num">{v.ratePct}%</td>
                  <td className="text-right">
                    <Money cents={v.netCents} />
                  </td>
                  <td className="text-right">
                    <Money cents={v.vatCents} />
                  </td>
                  <td className="text-right">
                    <Money cents={v.grossCents} />
                  </td>
                </tr>
              ))}
              {!s.vat.length && (
                <tr>
                  <td colSpan={4} className="text-ink-3">
                    Δεν υπάρχουν πωλήσεις
                  </td>
                </tr>
              )}
            </tbody>
            {s.vat.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td>Σύνολο</td>
                  <td className="text-right">
                    <Money cents={s.vat.reduce((n, v) => n + v.netCents, 0)} />
                  </td>
                  <td className="text-right">
                    <Money cents={s.vat.reduce((n, v) => n + v.vatCents, 0)} />
                  </td>
                  <td className="text-right">
                    <Money cents={s.vat.reduce((n, v) => n + v.grossCents, 0)} />
                  </td>
                </tr>
              </tfoot>
            )}
          </TableWrap>
        </Section>
      </div>

      <Section title="Πωλήσεις ανά είδος" flush>
        <TableWrap>
          <thead>
            <tr>
              <th>Είδος</th>
              <th>Κατηγορία</th>
              <th className="text-right">Τεμ.</th>
              <th className="text-right">Τζίρος</th>
              <th className="text-right">Κόστος</th>
              <th className="text-right">Περιθώριο</th>
              <th className="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {byProduct.map((r) => (
              <tr key={r.productId}>
                <td className="font-medium">{r.name}</td>
                <td className="text-ink-2">{r.category}</td>
                <td className="text-right num">{r.qty}</td>
                <td className="text-right">
                  <Money cents={r.grossCents} />
                </td>
                <td className="text-right">{r.costCents ? <Money cents={r.costCents} /> : <span className="text-ink-3">—</span>}</td>
                <td className="text-right">{r.costCents ? <Money cents={r.marginCents} /> : <span className="text-ink-3">—</span>}</td>
                <td className={`text-right num ${!r.costCents ? "text-ink-3" : r.marginPct < 50 ? "text-warn" : "text-ok"}`}>{r.costCents ? `${r.marginPct}%` : "—"}</td>
              </tr>
            ))}
            {!byProduct.length && (
              <tr>
                <td colSpan={7} className="text-ink-3">
                  Δεν υπάρχουν πωλήσεις στην περίοδο
                </td>
              </tr>
            )}
          </tbody>
          {byProduct.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2}>Σύνολο</td>
                <td className="text-right num">{totalQty}</td>
                <td className="text-right">
                  <Money cents={s.grossCents} />
                </td>
                <td className="text-right">
                  <Money cents={totalCost} />
                </td>
                <td className="text-right">
                  <Money cents={s.grossCents - totalCost} />
                </td>
                <td className="text-right num">{s.grossCents ? Math.round(((s.grossCents - totalCost) / s.grossCents) * 100) : 0}%</td>
              </tr>
            </tfoot>
          )}
        </TableWrap>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Πωλήσεις ανά κατηγορία" flush>
          <TableWrap>
            <thead>
              <tr>
                <th>Κατηγορία</th>
                <th className="text-right">Τεμ.</th>
                <th className="text-right">Τζίρος</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map((r) => (
                <tr key={r.category}>
                  <td className="font-medium">{r.category}</td>
                  <td className="text-right num">{r.qty}</td>
                  <td className="text-right">
                    <Money cents={r.grossCents} />
                  </td>
                  <td className="text-right num text-ink-2">{s.grossCents ? Math.round((r.grossCents / s.grossCents) * 100) : 0}%</td>
                </tr>
              ))}
              {!byCategory.length && (
                <tr>
                  <td colSpan={4} className="text-ink-3">
                    Δεν υπάρχουν πωλήσεις
                  </td>
                </tr>
              )}
            </tbody>
          </TableWrap>
        </Section>
        <Section title="Πωλήσεις ανά σερβιτόρο" flush>
          <TableWrap>
            <thead>
              <tr>
                <th>Υπάλληλος</th>
                <th className="text-right">Λογαριασμοί</th>
                <th className="text-right">Γύροι</th>
                <th className="text-right">Τζίρος</th>
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((r) => (
                <tr key={r.employeeId}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-right num">{r.sessions}</td>
                  <td className="text-right num">{r.rounds}</td>
                  <td className="text-right">
                    <Money cents={r.grossCents} />
                  </td>
                </tr>
              ))}
              {!byEmployee.length && (
                <tr>
                  <td colSpan={4} className="text-ink-3">
                    Δεν υπάρχουν πωλήσεις
                  </td>
                </tr>
              )}
            </tbody>
          </TableWrap>
        </Section>
      </div>
    </div>
  );
}
