import { Money } from "@/components/ui";
import { Section, TableWrap } from "@/components/admin/common";
import { fmtQty } from "@/components/admin/format";

type Row = { ingredientId: number; name: string; unitLabel: string; cost: number; purchased: number; sold: number; waste: number; countDiff: number };

/** Ανάλυση κατανάλωσης ανά πρώτη ύλη (server component: η φόρμα κάνει GET). */
export function ConsumptionTab({ from, to, rows }: { from: string; to: string; rows: Row[] }) {
  const totals = rows.reduce(
    (t, r) => ({ waste: t.waste + r.waste * r.cost * 100, sold: t.sold + r.sold * r.cost * 100, countDiff: t.countDiff + r.countDiff * r.cost * 100 }),
    { waste: 0, sold: 0, countDiff: 0 },
  );
  return (
    <Section
      title="Κατανάλωση ανά πρώτη ύλη"
      actions={
        <form method="get" action="/admin/inventory" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="consumption" />
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
      }
      flush
    >
      {rows.length ? (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th>Πρώτη ύλη</th>
                <th className="text-right">Παραλαβές</th>
                <th className="text-right">Πωλήσεις</th>
                <th className="text-right">Φύρα</th>
                <th className="text-right">Διαφορά απογραφής</th>
                <th className="text-right">Κόστος πωλήσεων</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ingredientId}>
                  <td className="font-medium">
                    {r.name} <span className="text-xs text-ink-3">{r.unitLabel}</span>
                  </td>
                  <td className="text-right num text-ok">{r.purchased ? fmtQty(r.purchased) : "—"}</td>
                  <td className="text-right num">{r.sold ? fmtQty(r.sold) : "—"}</td>
                  <td className="text-right num text-danger">{r.waste ? fmtQty(r.waste) : "—"}</td>
                  <td className={`text-right num ${r.countDiff < 0 ? "text-danger" : r.countDiff > 0 ? "text-ok" : ""}`}>{r.countDiff ? fmtQty(r.countDiff, true) : "—"}</td>
                  <td className="text-right">
                    <Money cents={Math.round(r.sold * r.cost * 100)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-line text-sm text-ink-2">
            <span>
              Κόστος πωλήσεων: <Money cents={Math.round(totals.sold)} className="font-semibold text-ink" />
            </span>
            <span>
              Αξία φύρας: <Money cents={Math.round(totals.waste)} className="font-semibold text-danger" />
            </span>
            <span>
              Αξία διαφορών απογραφής: <Money cents={Math.round(totals.countDiff)} className={`font-semibold ${totals.countDiff < 0 ? "text-danger" : "text-ink"}`} />
            </span>
          </div>
        </>
      ) : (
        <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν κινήσεις στο διάστημα.</div>
      )}
    </Section>
  );
}
