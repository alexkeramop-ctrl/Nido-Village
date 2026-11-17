"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Badge, Money, Stat } from "@/components/ui";
import { PageHeader, Section } from "@/components/admin/common";
import { DateGR } from "@/components/admin/date-gr";
import { fmtIsoDate } from "@/components/admin/format";
import { fmtDateTime, fmtTime } from "@/components/ops/labels";
import type { DayTotals, ShiftDto } from "@/server/services/registers";

type ShiftRow = ShiftDto & { carriedOver: boolean };
export type DayDto = {
  date: string;
  registers: { registerId: number | null; name: string; active: boolean; shifts: ShiftRow[]; totals: DayTotals }[];
  unassigned: { salesCount: number; cashCents: number; cardCents: number; otherCents: number; totalCents: number };
  total: DayTotals;
  grandTotalCents: number;
};

function shiftDay(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Diff({ cents, open = false }: { cents: number | null; open?: boolean }) {
  if (open || cents === null) return <span className="text-ink-3">—</span>;
  if (cents === 0) return <span className="text-ok font-semibold">0,00 €</span>;
  return (
    <span className={`font-bold whitespace-nowrap ${cents > 0 ? "text-warn" : "text-danger"}`}>
      {cents > 0 ? "+" : "−"}
      <Money cents={Math.abs(cents)} /> <span className="text-xs font-medium">{cents > 0 ? "πλεόνασμα" : "έλλειμμα"}</span>
    </span>
  );
}

/** Σύνοψη ημέρας ανά ταμείο, εκτυπώσιμη. */
export function RegistersView({ day, today }: { day: DayDto; today: string }) {
  const router = useRouter();
  const [loading, start] = useTransition();
  const go = (date: string) => start(() => router.push(date === today ? "/admin/registers" : `/admin/registers?date=${date}`));
  const anyOther = day.total.otherCents > 0 || day.unassigned.otherCents > 0;
  const closedShifts = day.total.shifts - day.total.openShifts;

  return (
    <div className="space-y-4 print:space-y-3">
      <style>{`@media print { header, nav, .print\\:hidden { display: none !important; } body { background: #fff; } .card { box-shadow: none; break-inside: avoid; } }`}</style>
      <PageHeader
        title="Ταμεία ημέρας"
        subtitle={`Κάθε βάρδια κάθε ταμείου για ${fmtIsoDate(day.date)}: εισπράξεις ανά τρόπο, αναμενόμενα και μετρημένα μετρητά, διαφορά.`}
        actions={
          <button className="btn-secondary btn-sm" onClick={() => window.print()}>
            Εκτύπωση
          </button>
        }
      />

      <div className={`card p-3 flex flex-wrap items-center gap-2 print:hidden ${loading ? "opacity-60" : ""}`}>
        <button type="button" className="btn-secondary btn-sm" onClick={() => go(shiftDay(day.date, -1))} aria-label="Προηγούμενη ημέρα">
          ‹
        </button>
        <div className="min-w-0" role="group" aria-label="Ημερομηνία">
          <DateGR value={day.date} onChange={go} compact />
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => go(shiftDay(day.date, 1))} disabled={day.date >= today} aria-label="Επόμενη ημέρα">
          ›
        </button>
        {day.date !== today && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => go(today)}>
            Σήμερα
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Σύνολο ημέρας" value={<Money cents={day.grandTotalCents} />} sub={`${day.total.salesCount + day.unassigned.salesCount} πωλήσεις`} />
        <Stat label="Μετρητά" value={<Money cents={day.total.cashCents + day.unassigned.cashCents} />} />
        <Stat label="Κάρτα" value={<Money cents={day.total.cardCents + day.unassigned.cardCents} />} />
        <Stat label="Βάρδιες" value={day.total.shifts} sub={day.total.openShifts ? `${day.total.openShifts} ακόμη ανοιχτές` : "όλες κλειστές"} tone={day.total.openShifts ? "warn" : undefined} />
        <Stat
          label="Διαφορά μετρητών"
          value={closedShifts ? <Diff cents={day.total.diffCents} /> : "—"}
          sub={closedShifts ? `από ${closedShifts} κλειστές βάρδιες` : "δεν έχει κλείσει βάρδια"}
        />
      </div>

      {day.registers.map((r) => (
        <Section
          key={r.registerId ?? "legacy"}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {r.name}
              {!r.active && r.registerId !== null && <Badge>Ανενεργό</Badge>}
              {r.totals.openShifts > 0 && <Badge tone="warn">Ανοιχτή βάρδια</Badge>}
            </span>
          }
          actions={
            r.shifts.length > 0 ? (
              <span className="text-sm text-ink-2">
                Σύνολο <Money cents={r.totals.totalCents} className="font-bold text-ink" />
              </span>
            ) : undefined
          }
          flush
        >
          {r.shifts.length === 0 ? (
            <p className="p-4 text-sm text-ink-3">Καμία βάρδια αυτή την ημέρα.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-grid" aria-label={`Βάρδιες · ${r.name}`}>
                <thead>
                  <tr>
                    <th>Βάρδια</th>
                    <th className="text-right">Πωλήσεις</th>
                    <th className="text-right">Μετρητά</th>
                    <th className="text-right">Κάρτα</th>
                    {anyOther && <th className="text-right">Άλλο</th>}
                    <th className="text-right">Σύνολο</th>
                    <th className="text-right">Αρχικό</th>
                    <th className="text-right">Αναμενόμενα</th>
                    <th className="text-right">Μετρημένα</th>
                    <th className="text-right">Διαφορά</th>
                  </tr>
                </thead>
                <tbody>
                  {r.shifts.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap">
                        <div className="num font-medium">
                          {s.carriedOver ? fmtDateTime(s.openedAt) : fmtTime(s.openedAt)} – {s.closedAt ? fmtTime(s.closedAt) : <Badge tone="warn">ανοιχτή</Badge>}
                        </div>
                        <div className="text-xs text-ink-3">
                          {s.openedBy}
                          {s.closedBy && s.closedBy !== s.openedBy ? ` → ${s.closedBy}` : ""}
                          {s.carriedOver ? " · από προηγούμενη ημέρα" : ""}
                        </div>
                        {s.notes && <div className="text-xs text-ink-2 whitespace-normal max-w-56">Σημ.: {s.notes}</div>}
                      </td>
                      <td className="text-right num">{s.salesCount}</td>
                      <td className="text-right">
                        <Money cents={s.byMethod.cash.totalCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={s.byMethod.card.totalCents} />
                      </td>
                      {anyOther && (
                        <td className="text-right">
                          <Money cents={s.byMethod.other.totalCents} />
                        </td>
                      )}
                      <td className="text-right font-semibold">
                        <Money cents={s.totalCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={s.openingFloatCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={s.expectedCashCents} />
                      </td>
                      <td className="text-right">{s.closedAt && s.countedCashCents !== null ? <Money cents={s.countedCashCents} /> : <span className="text-ink-3">—</span>}</td>
                      <td className="text-right">
                        <Diff cents={s.diffCents} open={!s.closedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {r.shifts.length > 1 && (
                  <tfoot>
                    <tr className="font-semibold">
                      <td>Σύνολο {r.name}</td>
                      <td className="text-right num">{r.totals.salesCount}</td>
                      <td className="text-right">
                        <Money cents={r.totals.cashCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={r.totals.cardCents} />
                      </td>
                      {anyOther && (
                        <td className="text-right">
                          <Money cents={r.totals.otherCents} />
                        </td>
                      )}
                      <td className="text-right">
                        <Money cents={r.totals.totalCents} />
                      </td>
                      <td colSpan={2}></td>
                      <td className="text-right">{r.totals.shifts - r.totals.openShifts > 0 ? <Money cents={r.totals.countedCashCents} /> : ""}</td>
                      <td className="text-right">{r.totals.shifts - r.totals.openShifts > 0 ? <Diff cents={r.totals.diffCents} /> : ""}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Section>
      ))}

      <Section title="Γενικό σύνολο ημέρας" flush>
        <div className="overflow-x-auto">
          <table className="table-grid" aria-label="Γενικό σύνολο ημέρας">
            <thead>
              <tr>
                <th></th>
                <th className="text-right">Πωλήσεις</th>
                <th className="text-right">Μετρητά</th>
                <th className="text-right">Κάρτα</th>
                {anyOther && <th className="text-right">Άλλο</th>}
                <th className="text-right">Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Όλα τα ταμεία ({day.total.shifts} βάρδιες)</td>
                <td className="text-right num">{day.total.salesCount}</td>
                <td className="text-right">
                  <Money cents={day.total.cashCents} />
                </td>
                <td className="text-right">
                  <Money cents={day.total.cardCents} />
                </td>
                {anyOther && (
                  <td className="text-right">
                    <Money cents={day.total.otherCents} />
                  </td>
                )}
                <td className="text-right">
                  <Money cents={day.total.totalCents} />
                </td>
              </tr>
              {day.unassigned.totalCents > 0 && (
                <tr>
                  <td>
                    Χωρίς ταμείο <span className="text-xs text-ink-3">(πληρωμές εκτός βάρδιας)</span>
                  </td>
                  <td className="text-right num">{day.unassigned.salesCount}</td>
                  <td className="text-right">
                    <Money cents={day.unassigned.cashCents} />
                  </td>
                  <td className="text-right">
                    <Money cents={day.unassigned.cardCents} />
                  </td>
                  {anyOther && (
                    <td className="text-right">
                      <Money cents={day.unassigned.otherCents} />
                    </td>
                  )}
                  <td className="text-right">
                    <Money cents={day.unassigned.totalCents} />
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold text-base">
                <td>Σύνολο ημέρας</td>
                <td className="text-right num">{day.total.salesCount + day.unassigned.salesCount}</td>
                <td className="text-right">
                  <Money cents={day.total.cashCents + day.unassigned.cashCents} />
                </td>
                <td className="text-right">
                  <Money cents={day.total.cardCents + day.unassigned.cardCents} />
                </td>
                {anyOther && (
                  <td className="text-right">
                    <Money cents={day.total.otherCents + day.unassigned.otherCents} />
                  </td>
                )}
                <td className="text-right" data-testid="day-grand-total">
                  <Money cents={day.grandTotalCents} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-ink-3 border-t border-line">
          Μια βάρδια ανήκει στην ημέρα που άνοιξε. Το «Σύνολο ημέρας» συμφωνεί με τα έσοδα ταμείου στα{" "}
          <Link href="/admin/finance" className="underline print:no-underline">
            Έσοδα – Έξοδα
          </Link>{" "}
          όταν οι βάρδιες ανοίγουν και κλείνουν την ίδια ημέρα.
        </p>
      </Section>
    </div>
  );
}
