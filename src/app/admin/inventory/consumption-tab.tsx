import { Money } from "@/components/ui";
import { InfoBox, Section, TableWrap } from "@/components/admin/common";
import { fmtQty, pluralGr } from "@/components/admin/format";
import { formatEuro } from "@/server/money";

type Row = {
  ingredientId: number;
  name: string;
  unitLabel: string;
  cost: number;
  purchased: number;
  sold: number;
  waste: number;
  countDiff: number;
  /** Πωλήσεις / απόκλιση απογραφής σε μερίδες (null αν δεν έχει οριστεί μερίδα). */
  soldPortions: number | null;
  countDiffPortions: number | null;
  /** Απόκλιση απογραφής σε λεπτά (αρνητικό = χαμένη αξία). */
  countDiffCents: number;
  portionQty: number | null;
  portionName: string | null;
  packSize: number | null;
  packName: string | null;
};

const signCls = (n: number) => (n < 0 ? "text-danger" : n > 0 ? "text-ok" : "");

/** Ανάλυση κατανάλωσης ανά πρώτη ύλη (server component: η φόρμα κάνει GET). */
export function ConsumptionTab({ from, to, rows }: { from: string; to: string; rows: Row[] }) {
  const totals = rows.reduce(
    (t, r) => ({ waste: t.waste + r.waste * r.cost * 100, sold: t.sold + r.sold * r.cost * 100, countDiff: t.countDiff + r.countDiffCents }),
    { waste: 0, sold: 0, countDiff: 0 },
  );
  const hasPortions = rows.some((r) => r.portionQty);
  return (
    <div className="space-y-4">
      <InfoBox>
        <strong>Απόκλιση απογραφής</strong> = τι έδειξε η απογραφή σε σχέση με ό,τι περίμενε το σύστημα μετά τις πωλήσεις και τη φύρα. Παράδειγμα: μπουκάλι
        βότκας 700 ml, ποτό 60 ml. Αν πουλήθηκαν 6 ποτά αλλά η απογραφή έδειξε άδειο μπουκάλι, η απόκλιση είναι −5 ποτά (λείπουν 5 ποτά που δεν χρεώθηκαν). Θετική
        απόκλιση σημαίνει ότι βρέθηκε περισσότερο από το αναμενόμενο.
      </InfoBox>
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
                  {hasPortions && <th className="text-right">Πωλήσεις (μερίδες)</th>}
                  <th className="text-right">Φύρα</th>
                  <th className="text-right">Απόκλιση απογραφής</th>
                  <th className="text-right">Κόστος πωλήσεων</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const portionName = pluralGr(r.portionName ?? "μερίδα", 2);
                  return (
                    <tr key={r.ingredientId} data-testid={`consumption-${r.ingredientId}`}>
                      <td className="font-medium">
                        {r.name} <span className="text-xs text-ink-3">{r.unitLabel}</span>
                        {(r.packSize || r.portionQty) && (
                          <div className="text-xs text-ink-3 num whitespace-nowrap">
                            {[
                              r.packSize ? `${r.packName ?? "συσκευασία"} ${fmtQty(r.packSize)} ${r.unitLabel}` : null,
                              r.portionQty ? `${r.portionName ?? "μερίδα"} ${fmtQty(r.portionQty)} ${r.unitLabel}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="text-right num text-ok">{r.purchased ? fmtQty(r.purchased) : "—"}</td>
                      <td className="text-right num">{r.sold ? fmtQty(r.sold) : "—"}</td>
                      {hasPortions && (
                        <td className="text-right num whitespace-nowrap">{r.soldPortions !== null && r.sold ? `${fmtQty(r.soldPortions)} ${portionName}` : "—"}</td>
                      )}
                      <td className="text-right num text-danger">{r.waste ? fmtQty(r.waste) : "—"}</td>
                      <td className={`text-right num whitespace-nowrap ${signCls(r.countDiff)}`}>
                        {r.countDiff ? (
                          <>
                            <div>
                              {fmtQty(r.countDiff, true)} {r.unitLabel}
                            </div>
                            {r.countDiffPortions !== null && (
                              <div className="text-xs">
                                {fmtQty(r.countDiffPortions, true)} {portionName}
                              </div>
                            )}
                            <div className="text-xs font-semibold">{formatEuro(r.countDiffCents)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-right">
                        <Money cents={Math.round(r.sold * r.cost * 100)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={hasPortions ? 5 : 4} className="text-right text-ink-2">
                    Σύνολο απόκλισης απογραφής (€)
                  </td>
                  <td className={`text-right num ${signCls(totals.countDiff)}`} data-testid="consumption-variance-total">
                    {formatEuro(Math.round(totals.countDiff))}
                  </td>
                  <td className="text-right">
                    <Money cents={Math.round(totals.sold)} />
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
            <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-line text-sm text-ink-2">
              <span>
                Κόστος πωλήσεων: <Money cents={Math.round(totals.sold)} className="font-semibold text-ink" />
              </span>
              <span>
                Αξία φύρας: <Money cents={Math.round(totals.waste)} className="font-semibold text-danger" />
              </span>
              <span>
                Αξία διαφορών απογραφής:{" "}
                <Money cents={Math.round(totals.countDiff)} className={`font-semibold ${totals.countDiff < 0 ? "text-danger" : totals.countDiff > 0 ? "text-ok" : "text-ink"}`} />
              </span>
            </div>
          </>
        ) : (
          <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν κινήσεις στο διάστημα.</div>
        )}
      </Section>
    </div>
  );
}
