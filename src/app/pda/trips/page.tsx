import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { hasRole } from "@/server/auth";
import { EVENT_STATUS_LABEL, listEvents } from "@/server/services/events";
import { addDays, todayAthens } from "@/server/services/reports";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { Badge } from "@/components/ui";
import { MONTH_RE, WEEKDAYS_SHORT, longDateLabel, monthGrid, monthLabel, shiftMonth } from "@/components/admin/events/dates";
import { EVENT_STATUS_TONE } from "@/components/admin/events/meta";

export const dynamic = "force-dynamic";

type Trip = Awaited<ReturnType<typeof listEvents>>[number];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function dayWord(iso: string, today: string): string {
  if (iso === today) return "Σήμερα";
  if (iso === addDays(today, 1)) return "Αύριο";
  return longDateLabel(iso);
}

function peopleLabel(n: number): string {
  return n === 1 ? "1 άτομο" : `${n} άτομα`;
}

/**
 * PDA: ημερολόγιο σχολικών εκδρομών για το προσωπικό.
 * Μόνο ανάγνωση: οι εκδρομές καταχωρούνται στη Διαχείριση › Εκδηλώσεις. Τιμές και προκαταβολές δεν εμφανίζονται εδώ,
 * το τηλέφωνο επικοινωνίας μόνο σε υπεύθυνο και διαχειριστή.
 */
export default async function PdaTripsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser("kitchen", "waiter", "cashier", "manager", "admin");
  const canManage = hasRole(user, "manager", "admin");
  const sp = await searchParams;
  const today = todayAthens();
  const m = one(sp.m);
  const month = m && MONTH_RE.test(m) ? m : today.slice(0, 7);
  const grid = monthGrid(month);

  const [gridTrips, upcoming] = await Promise.all([
    listEvents(grid.from, grid.to, { type: "school_trip" }),
    listEvents(today, addDays(today, 60), { type: "school_trip" }),
  ]);
  const next = upcoming.find((t) => t.status !== "done") ?? null;

  const byDay = new Map<string, Trip[]>();
  for (const t of gridTrips) {
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }
  const monthDays = [...byDay.keys()].filter((d) => d.startsWith(month)).sort();
  const monthTrips = monthDays.flatMap((d) => byDay.get(d) ?? []);
  const monthPeople = monthTrips.reduce((s, t) => s + t.guests, 0);
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <Shell user={user} active="/pda/trips" title="Σχολικές εκδρομές">
      <LiveRefresh types={["catalog.changed"]} pollMs={60000} />
      <main className="flex-1 w-full max-w-3xl mx-auto p-3 space-y-3">
        {next && (
          <section className="card p-4 bg-brand-soft border-brand-light" aria-labelledby="next-trip" data-testid="next-trip">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-2">Επόμενη εκδρομή</div>
              <Badge tone={EVENT_STATUS_TONE[next.status]}>{EVENT_STATUS_LABEL[next.status]}</Badge>
            </div>
            <h2 id="next-trip" className="text-lg font-bold leading-snug mt-0.5">
              {dayWord(next.date, today)} · {next.startTime}
            </h2>
            <div className="font-semibold">{next.title}</div>
            <div className="text-sm text-ink-2 num">
              {peopleLabel(next.guests)}
              {next.area ? ` · ${next.area.name}` : ""}
            </div>
          </section>
        )}

        <div className="card p-2 flex flex-wrap items-center gap-2">
          <Link href={{ pathname: "/pda/trips", query: { m: prevMonth } }} className="btn-secondary btn-sm num" aria-label="Προηγούμενος μήνας" title={monthLabel(prevMonth)}>
            ‹
          </Link>
          <Link href={{ pathname: "/pda/trips", query: { m: nextMonth } }} className="btn-secondary btn-sm num" aria-label="Επόμενος μήνας" title={monthLabel(nextMonth)}>
            ›
          </Link>
          <Link href="/pda/trips" className="btn-ghost btn-sm">
            Σήμερα
          </Link>
          <div className="font-semibold text-lg ml-1" data-testid="trips-month">
            {monthLabel(month)}
          </div>
          <div className="ml-auto text-sm text-ink-2 num">
            {monthTrips.length} {monthTrips.length === 1 ? "εκδρομή" : "εκδρομές"} · {peopleLabel(monthPeople)}
          </div>
        </div>

        <div className="card overflow-hidden" data-testid="trips-grid">
          <div className="grid grid-cols-7 bg-surface-3 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            {WEEKDAYS_SHORT.map((d) => (
              <div key={d} className="py-1.5 text-center">
                {d}
              </div>
            ))}
          </div>
          {grid.weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-t border-line">
              {week.map((iso) => {
                const inMonth = iso.startsWith(month);
                const list = inMonth ? (byDay.get(iso) ?? []) : [];
                const people = list.reduce((s, t) => s + t.guests, 0);
                const isToday = iso === today;
                const body = (
                  <>
                    <span className={`text-sm num ${isToday ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white font-bold" : "font-medium"}`}>
                      {Number(iso.slice(8))}
                    </span>
                    {list.length > 0 && (
                      <span className="mt-0.5 flex flex-col items-center leading-tight">
                        <span className="inline-block h-2 w-2 rounded-full bg-green-500" aria-hidden />
                        <span className="text-[10px] font-semibold text-green-800 num">{people}</span>
                      </span>
                    )}
                  </>
                );
                const cls = `min-h-14 flex flex-col items-center pt-1.5 pb-1 border-l border-line first:border-l-0 ${inMonth ? "" : "opacity-35"}`;
                return list.length > 0 ? (
                  <a
                    key={iso}
                    href={`#d-${iso}`}
                    className={`${cls} bg-green-50 hover:bg-green-100 touch`}
                    aria-label={`${longDateLabel(iso)}: ${list.length} ${list.length === 1 ? "εκδρομή" : "εκδρομές"}, ${peopleLabel(people)}`}
                  >
                    {body}
                  </a>
                ) : (
                  <div key={iso} className={cls}>
                    {body}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-3 px-1 -mt-1">Πατήστε μια πράσινη μέρα για τις λεπτομέρειες. Ο αριθμός δείχνει πόσα άτομα έρχονται εκείνη τη μέρα.</p>

        {monthTrips.length === 0 ? (
          <div className="card p-6 text-center text-ink-2">
            <div className="font-semibold text-ink">Δεν υπάρχουν σχολικές εκδρομές αυτόν τον μήνα</div>
            <div className="text-sm mt-1">Οι εκδρομές καταχωρούνται από τον υπεύθυνο στη Διαχείριση › Εκδηλώσεις.</div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="trips-list">
            {monthDays.map((iso) => (
              <section key={iso} id={`d-${iso}`} className="scroll-mt-16 space-y-2">
                <h2 className={`text-sm font-bold uppercase tracking-wide ${iso === today ? "text-brand-2" : "text-ink-2"}`}>{dayWord(iso, today)}</h2>
                {(byDay.get(iso) ?? []).map((t) => (
                  <article key={t.id} className={`card p-3 space-y-1.5 ${t.date < today || t.status === "done" ? "opacity-70" : ""}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-bold num leading-tight">
                          {t.startTime}–{t.endTime}
                        </div>
                        <div className="font-semibold leading-snug">{t.title}</div>
                      </div>
                      <Badge tone={EVENT_STATUS_TONE[t.status]}>{EVENT_STATUS_LABEL[t.status]}</Badge>
                    </div>
                    <div className="text-sm text-ink-2 num">
                      {peopleLabel(t.guests)}
                      {t.area ? ` · ${t.area.name}` : ""}
                    </div>
                    {t.menuNotes && (
                      <div className="text-sm">
                        <span className="font-semibold">Μενού: </span>
                        {t.menuNotes}
                      </div>
                    )}
                    {t.notes && <div className="text-sm rounded-lg bg-warn-soft text-warn px-2 py-1">{t.notes}</div>}
                    {t.customerName && (
                      <div className="text-xs text-ink-3">
                        Υπεύθυνος: {t.customerName}
                        {canManage && t.customerPhone && (
                          <>
                            {" · "}
                            <a href={`tel:${t.customerPhone}`} className="underline underline-offset-2 num">
                              {t.customerPhone}
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}

        {canManage && (
          <div className="text-center pb-4">
            <Link href={{ pathname: "/admin/events", query: { m: month } }} className="text-sm font-medium text-brand-2 underline underline-offset-2">
              Νέα εκδρομή ή αλλαγή στη Διαχείριση › Εκδηλώσεις
            </Link>
          </div>
        )}
      </main>
    </Shell>
  );
}
