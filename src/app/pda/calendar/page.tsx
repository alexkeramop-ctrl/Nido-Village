import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { hasRole } from "@/server/auth";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, listEvents } from "@/server/services/events";
import { addDays, todayAthens } from "@/server/services/reports";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { Badge } from "@/components/ui";
import { MONTH_RE, WEEKDAYS_SHORT, longDateLabel, monthGrid, monthLabel, shiftMonth } from "@/components/admin/events/dates";
import { EVENT_STATUS_TONE, EVENT_TYPE_CHIP, EVENT_TYPE_DOT, EVENT_TYPES, SCOPES, timeRange, type CalendarScope } from "@/components/admin/events/meta";
import { ADULT_MENUS, PARTY_EXTRAS, packageByKey } from "@/components/admin/events/party";

export const dynamic = "force-dynamic";

type Ev = Awaited<ReturnType<typeof listEvents>>[number];

const FILTERS: { scope: CalendarScope; label: string }[] = [
  { scope: "all", label: "Όλα" },
  { scope: "parties", label: "Πάρτι" },
  { scope: "ceremonies", label: "Γάμοι & Βαπτίσεις" },
  { scope: "trips", label: "Εκδρομές" },
];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function dayWord(iso: string, today: string): string {
  if (iso === today) return "Σήμερα";
  if (iso === addDays(today, 1)) return "Αύριο";
  return longDateLabel(iso);
}

/** Πόσα άτομα έρχονται: στα πάρτι παιδιά και ενήλικες, στα ραντεβού κανένας. */
function headcount(e: Ev): number {
  if (e.type === "appointment") return 0;
  if (e.type === "party" && e.party) return (e.party.kids ?? 0) + (e.party.adults ?? 0) || e.guests;
  return e.guests;
}

function peopleText(e: Ev): string | null {
  if (e.type === "appointment") return null;
  if (e.type === "party" && e.party && (e.party.kids || e.party.adults)) {
    return [e.party.kids ? `${e.party.kids} παιδιά` : null, e.party.adults ? `${e.party.adults} ενήλικες` : null].filter(Boolean).join(" · ");
  }
  if (!e.guests) return null;
  return e.guests === 1 ? "1 άτομο" : `${e.guests} άτομα`;
}

/** Στοιχεία πάρτι για την προετοιμασία, χωρίς τιμές. */
function partyLines(e: Ev): string[] {
  const p = e.party;
  if (e.type !== "party" || !p) return [];
  const menu = ADULT_MENUS.find((m) => m.key === p.adultMenu && m.key !== "none");
  const extras = (p.extras ?? []).map((k) => PARTY_EXTRAS.find((x) => x.key === k)?.name).filter(Boolean);
  return [
    p.childName ? `${p.childName}${p.childAge ? `, ${p.childAge} ετών` : ""}` : null,
    packageByKey(p.package)?.name ?? null,
    menu ? `Ενήλικες: ${menu.name.replace(/\s*\(.*\)\s*$/, "")}` : null,
    extras.length ? `Έξτρα: ${extras.join(", ")}` : null,
    p.theme ? `Θέμα: ${p.theme}` : null,
    p.cake ? `Τούρτα: ${p.cake}` : null,
  ].filter((x): x is string => !!x);
}

/**
 * Ημερολόγιο εκδηλώσεων για το προσωπικό (ταμίας, μπαρ, κουζίνα): πάρτι, γάμοι, βαπτίσεις, εκδρομές, εταιρικά.
 * Μόνο ανάγνωση: η καταχώρηση γίνεται στη Διαχείριση. Τιμές και προκαταβολές δεν εμφανίζονται,
 * το τηλέφωνο του πελάτη μόνο σε υπεύθυνο και διαχειριστή.
 */
export default async function PdaCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser("kitchen", "waiter", "cashier", "manager", "admin");
  const canManage = hasRole(user, "manager", "admin");
  const sp = await searchParams;
  const today = todayAthens();
  const m = one(sp.m);
  const month = m && MONTH_RE.test(m) ? m : today.slice(0, 7);
  const s = one(sp.s);
  const scope: CalendarScope = FILTERS.some((f) => f.scope === s) ? (s as CalendarScope) : "all";
  const types = new Set(SCOPES[scope].types);
  const grid = monthGrid(month);

  const [gridEvents, upcoming] = await Promise.all([listEvents(grid.from, grid.to), listEvents(today, addDays(today, 60))]);
  const events = gridEvents.filter((e) => types.has(e.type));
  const next = upcoming.find((e) => types.has(e.type) && e.status !== "done") ?? null;

  const byDay = new Map<string, Ev[]>();
  for (const e of events) {
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }
  const monthDays = [...byDay.keys()].filter((d) => d.startsWith(month)).sort();
  const monthEvents = monthDays.flatMap((d) => byDay.get(d) ?? []);
  const monthPeople = monthEvents.reduce((sum, e) => sum + headcount(e), 0);
  const shownTypes = EVENT_TYPES.filter((t) => monthEvents.some((e) => e.type === t));
  const href = (q: { m?: string; s?: CalendarScope }) => {
    const query: Record<string, string> = {};
    const mm = q.m ?? month;
    const ss = q.s ?? scope;
    if (mm !== today.slice(0, 7)) query.m = mm;
    if (ss !== "all") query.s = ss;
    return { pathname: "/pda/calendar", query };
  };

  return (
    <Shell user={user} active="/pda/calendar" title="Ημερολόγιο">
      <LiveRefresh types={["catalog.changed"]} pollMs={60000} />
      <main className="flex-1 w-full max-w-3xl mx-auto p-3 space-y-3">
        <nav aria-label="Είδος εκδήλωσης" className="flex gap-2 overflow-x-auto pb-0.5 touch">
          {FILTERS.map((f) => (
            <Link
              key={f.scope}
              href={href({ s: f.scope })}
              aria-current={f.scope === scope ? "page" : undefined}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium border ${f.scope === scope ? "bg-brand text-white border-brand" : "bg-surface-2 text-ink-2 border-line"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        {next && (
          <section className="card p-4 bg-brand-soft border-brand-light" aria-labelledby="next-event" data-testid="next-event">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-2">Επόμενη εκδήλωση</div>
              <Badge tone={EVENT_STATUS_TONE[next.status]}>{EVENT_STATUS_LABEL[next.status]}</Badge>
            </div>
            <h2 id="next-event" className="text-lg font-bold leading-snug mt-0.5">
              {dayWord(next.date, today)} · {next.startTime}
            </h2>
            <div className="font-semibold">
              {EVENT_TYPE_LABEL[next.type]}: {next.title}
            </div>
            <div className="text-sm text-ink-2 num">{[peopleText(next), next.area?.name].filter(Boolean).join(" · ")}</div>
          </section>
        )}

        <div className="card p-2 flex flex-wrap items-center gap-2">
          <Link href={href({ m: shiftMonth(month, -1) })} className="btn-secondary btn-sm num" aria-label="Προηγούμενος μήνας" title={monthLabel(shiftMonth(month, -1))}>
            ‹
          </Link>
          <Link href={href({ m: shiftMonth(month, 1) })} className="btn-secondary btn-sm num" aria-label="Επόμενος μήνας" title={monthLabel(shiftMonth(month, 1))}>
            ›
          </Link>
          <Link href={href({ m: today.slice(0, 7) })} className="btn-ghost btn-sm">
            Σήμερα
          </Link>
          <div className="font-semibold text-lg ml-1" data-testid="calendar-month">
            {monthLabel(month)}
          </div>
          <div className="ml-auto text-sm text-ink-2 num">
            {monthEvents.length} {monthEvents.length === 1 ? "εκδήλωση" : "εκδηλώσεις"}
            {monthPeople > 0 ? ` · ${monthPeople} άτομα` : ""}
          </div>
        </div>

        <div className="card overflow-hidden" data-testid="calendar-grid">
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
                const people = list.reduce((sum, e) => sum + headcount(e), 0);
                const dayTypes = EVENT_TYPES.filter((t) => list.some((e) => e.type === t));
                const isToday = iso === today;
                const body = (
                  <>
                    <span className={`text-sm num ${isToday ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white font-bold" : "font-medium"}`}>
                      {Number(iso.slice(8))}
                    </span>
                    {list.length > 0 && (
                      <span className="mt-0.5 flex flex-col items-center leading-tight">
                        <span className="flex gap-0.5" aria-hidden>
                          {dayTypes.slice(0, 3).map((t) => (
                            <span key={t} className={`inline-block h-2 w-2 rounded-full ${EVENT_TYPE_DOT[t]}`} />
                          ))}
                        </span>
                        {people > 0 && <span className="text-[10px] font-semibold text-ink-2 num">{people}</span>}
                      </span>
                    )}
                  </>
                );
                const cls = `min-h-14 flex flex-col items-center pt-1.5 pb-1 border-l border-line first:border-l-0 ${inMonth ? "" : "opacity-35"}`;
                return list.length > 0 ? (
                  <a
                    key={iso}
                    href={`#d-${iso}`}
                    className={`${cls} bg-brand-soft hover:bg-surface-3 touch`}
                    aria-label={`${longDateLabel(iso)}: ${list.length} ${list.length === 1 ? "εκδήλωση" : "εκδηλώσεις"}${people ? `, ${people} άτομα` : ""}`}
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
        <div className="px-1 -mt-1 space-y-1">
          {shownTypes.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label="Υπόμνημα">
              {shownTypes.map((t) => (
                <li key={t} className="inline-flex items-center gap-1">
                  <span className={`inline-block h-2 w-2 rounded-full ${EVENT_TYPE_DOT[t]}`} />
                  {EVENT_TYPE_LABEL[t]}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-3">Πατήστε μια χρωματιστή μέρα για τις λεπτομέρειες. Ο αριθμός δείχνει πόσα άτομα έρχονται εκείνη τη μέρα.</p>
        </div>

        {monthEvents.length === 0 ? (
          <div className="card p-6 text-center text-ink-2">
            <div className="font-semibold text-ink">Δεν υπάρχουν εκδηλώσεις αυτόν τον μήνα</div>
            <div className="text-sm mt-1">Οι εκδηλώσεις καταχωρούνται από τον υπεύθυνο στη Διαχείριση.</div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="calendar-list">
            {monthDays.map((iso) => (
              <section key={iso} id={`d-${iso}`} className="scroll-mt-16 space-y-2">
                <h2 className={`text-sm font-bold uppercase tracking-wide ${iso === today ? "text-brand-2" : "text-ink-2"}`}>{dayWord(iso, today)}</h2>
                {(byDay.get(iso) ?? []).map((e) => {
                  const people = peopleText(e);
                  const party = partyLines(e);
                  return (
                    <article key={e.id} className={`card p-3 space-y-1.5 ${e.date < today || e.status === "done" ? "opacity-70" : ""}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${EVENT_TYPE_CHIP[e.type]}`}>{EVENT_TYPE_LABEL[e.type]}</span>
                          <div className="text-lg font-bold num leading-tight mt-1">{timeRange(e)}</div>
                          <div className="font-semibold leading-snug">{e.title}</div>
                        </div>
                        <Badge tone={EVENT_STATUS_TONE[e.status]}>{EVENT_STATUS_LABEL[e.status]}</Badge>
                      </div>
                      {(people || e.area) && <div className="text-sm text-ink-2 num">{[people, e.area?.name].filter(Boolean).join(" · ")}</div>}
                      {party.length > 0 && (
                        <ul className="text-sm space-y-0.5">
                          {party.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                      {e.menuNotes && (
                        <div className="text-sm">
                          <span className="font-semibold">Μενού: </span>
                          {e.menuNotes}
                        </div>
                      )}
                      {e.notes && <div className="text-sm rounded-lg bg-warn-soft text-warn px-2 py-1">{e.notes}</div>}
                      {e.customerName && (
                        <div className="text-xs text-ink-3">
                          Επικοινωνία: {e.customerName}
                          {canManage && e.customerPhone && (
                            <>
                              {" · "}
                              <a href={`tel:${e.customerPhone}`} className="underline underline-offset-2 num">
                                {e.customerPhone}
                              </a>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        )}

        {canManage && (
          <div className="text-center pb-4">
            <Link href={{ pathname: SCOPES[scope].path, query: { m: month } }} className="text-sm font-medium text-brand-2 underline underline-offset-2">
              Νέα εκδήλωση ή αλλαγή στη Διαχείριση › {SCOPES[scope].title}
            </Link>
          </div>
        )}
      </main>
    </Shell>
  );
}
