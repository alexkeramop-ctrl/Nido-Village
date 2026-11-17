"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Money } from "@/components/ui";
import { PageHeader, Section, useActionRunner } from "@/components/admin/common";
import { fmtIsoDate } from "@/components/admin/format";
import { LiveRefresh } from "@/components/live";
import { WEEKDAYS_SHORT, longDateLabel, monthLabel, shiftMonth, weekdayMon, type MonthGrid } from "@/components/admin/events/dates";
import { CANCELLED_CHIP, EVENT_STATUS_TONE, EVENT_TYPE_CHIP, EVENT_TYPE_DOT, SCOPES, timeRange, type CalendarScope } from "@/components/admin/events/meta";
import { packageByKey } from "@/components/admin/events/party";
import type { AreaOption, EventRow } from "@/components/admin/events/types";
import { payBadge, type BirthdayRow, type PayBadge } from "@/components/admin/bookings/meta";
import { BirthdaysSection } from "@/components/admin/bookings/birthdays";
import { EventPaymentsModal } from "@/components/admin/bookings/event-payments";
import { formatPhone, telHref, whatsappHref } from "@/lib/phone";
import type { EventStatus, EventType } from "@/db/schema";
import { deleteEventAction, setEventStatusAction } from "./actions";
import { EventForm } from "./event-form";

type ModalState = { mode: "new"; date: string } | { mode: "edit"; event: EventRow } | null;

const MAX_CHIPS = 3;

/** Αίτημα από τη φόρμα του site που περιμένει απάντηση. */
const isWebRequest = (ev: EventRow) => ev.source === "website" && ev.status === "inquiry";

/** Χρώμα της μικρής ετικέτας πληρωμής πάνω στα chips του ημερολογίου (λευκό φόντο για να ξεχωρίζει σε κάθε χρώμα). */
const PAY_PILL: Record<PayBadge["tone"], string> = {
  ok: "bg-white/85 text-ok",
  warn: "bg-white/85 text-warn",
  danger: "bg-white/85 text-danger",
  neutral: "bg-white/85 text-ink-2",
};

export function EventsCalendar({
  scope,
  month,
  today,
  grid,
  events,
  upcoming,
  requests,
  birthdays,
  areas,
  typeLabels,
  statusLabels,
  isAdmin,
  venueName,
}: {
  scope: CalendarScope;
  month: string;
  today: string;
  grid: MonthGrid;
  events: EventRow[];
  upcoming: EventRow[];
  /** Αιτήματα από το site που περιμένουν απάντηση (όλες οι ημερομηνίες από σήμερα). */
  requests: EventRow[];
  /** Γενέθλια που πλησιάζουν (μόνο στο ημερολόγιο των πάρτι). */
  birthdays: BirthdayRow[];
  areas: AreaOption[];
  typeLabels: Record<EventType, string>;
  statusLabels: Record<EventStatus, string>;
  isAdmin: boolean;
  venueName: string;
}) {
  const runner = useActionRunner();
  const { run, pending, toastElement } = runner;
  const [modal, setModal] = useState<ModalState>(null);
  const [paying, setPaying] = useState<EventRow | null>(null);
  const [modalSeq, setModalSeq] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const openNew = (date: string) => {
    setModalSeq((n) => n + 1);
    setModal({ mode: "new", date });
  };
  const openEdit = (event: EventRow) => {
    setModalSeq((n) => n + 1);
    setModal({ mode: "edit", event });
  };

  const setStatus = (ev: EventRow, status: EventStatus) =>
    run(() => setEventStatusAction(ev.id, status), { success: `«${ev.title}»: ${statusLabels[status]}` });

  const remove = (ev: EventRow) => {
    if (!window.confirm(`Διαγραφή της εκδήλωσης «${ev.title}» (${fmtIsoDate(ev.date)});`)) return;
    run(() => deleteEventAction(ev.id), { success: "Η εκδήλωση διαγράφηκε" });
  };

  /** Ετικέτα πληρωμής: «Εξοφλημένο», «Προκαταβολή ✓ · υπόλοιπο X €», «Χωρίς προκαταβολή». */
  const payBadgeOf = (ev: EventRow) => {
    const b = payBadge(ev.status, ev.pay);
    return b ? (
      <span data-testid="pay-badge" data-pay={ev.pay.state}>
        <Badge tone={b.tone}>{b.label}</Badge>
      </span>
    ) : null;
  };
  const phoneLink = (phone: string) => {
    const tel = telHref(phone);
    return tel ? (
      <a href={tel} className="num underline decoration-dotted underline-offset-2 hover:text-ink">
        {formatPhone(phone)}
      </a>
    ) : (
      <span className="num">{phone}</span>
    );
  };

  const conf = SCOPES[scope];
  const base = conf.path;
  const inMonthCount = events.filter((e) => e.date.startsWith(month) && e.status !== "cancelled").length;
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <div className="space-y-4 print:space-y-2">
      {toastElement}
      <LiveRefresh types={["catalog.changed"]} />
      <style>{`@media print {
        @page { size: A4 landscape; margin: 10mm; }
        header, nav, .print\\:hidden { display: none !important; }
        body { background: #fff; }
        .card { box-shadow: none; break-inside: avoid; }
        .cal-day { min-height: 0 !important; }
      }`}</style>

      <PageHeader
        title={conf.title}
        subtitle={`${monthLabel(month)} · ${inMonthCount} ${scope === "parties" ? (inMonthCount === 1 ? "πάρτι" : "πάρτι") : inMonthCount === 1 ? "εγγραφή" : "εγγραφές"} · ${conf.subtitle}`}
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => window.print()}>
              Εκτύπωση μήνα
            </button>
            <button className="btn-primary btn-sm" onClick={() => openNew(today.startsWith(month) ? today : `${month}-01`)}>
              {conf.newLabel}
            </button>
          </>
        }
      />

      {requests.length > 0 && (
        <section className="card border-2 border-dashed border-brand/50 print:hidden" data-testid="web-requests" aria-label="Αιτήματα από το site">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
            <h2 className="font-semibold">
              🌐 Αιτήματα από το site <span className="text-ink-3 font-normal num">· {requests.length}</span>
            </h2>
            <span className="text-xs text-ink-3">Ήρθαν από τη φόρμα του nidovillage.gr. Πάρε τηλέφωνο τον πελάτη και επιβεβαίωσε ή ακύρωσε.</span>
          </div>
          <ul className="divide-y divide-line">
            {requests.map((ev) => {
              const tel = telHref(ev.customerPhone);
              const wa = whatsappHref(ev.customerPhone);
              return (
                <li key={ev.id} className="px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4" data-event-id={ev.id}>
                  <div className="lg:w-32 shrink-0 flex lg:block items-baseline gap-2">
                    <div className="font-semibold num">
                      {WEEKDAYS_SHORT[weekdayMon(ev.date)]} {fmtIsoDate(ev.date)}
                    </div>
                    <div className="text-xs text-ink-3 num">{timeRange(ev)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium break-words">{ev.customerName || ev.title}</span>
                      <Badge>
                        <span className={`inline-block h-2 w-2 rounded-full mr-1 ${EVENT_TYPE_DOT[ev.type]}`} />
                        {typeLabels[ev.type]}
                      </Badge>
                      <Badge tone="brand">🌐 Αίτημα από site</Badge>
                    </div>
                    <div className="text-xs text-ink-3 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {ev.type === "party" && ev.party ? (
                        <span className="num">
                          {ev.party.kids ?? 0} παιδιά · {ev.party.adults ?? 0} ενήλικες
                        </span>
                      ) : (
                        <span className="num">{ev.guests} άτομα</span>
                      )}
                      {ev.customerPhone && <span>{phoneLink(ev.customerPhone)}</span>}
                      {ev.customerEmail && <span className="break-all">{ev.customerEmail}</span>}
                    </div>
                    {ev.notes && <div className="text-xs text-ink-2 mt-1 whitespace-pre-line break-words line-clamp-4">{ev.notes}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {tel && (
                      <a href={tel} className="btn-secondary btn-sm" aria-label={`Κλήση ${ev.customerName}`}>
                        📞 Κλήση
                      </a>
                    )}
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary btn-sm" aria-label={`WhatsApp ${ev.customerName}`}>
                        💬 WhatsApp
                      </a>
                    )}
                    <button className="btn-primary btn-sm" disabled={pending} onClick={() => setStatus(ev, "confirmed")} data-testid="request-confirm">
                      Επιβεβαίωση
                    </button>
                    <button className="btn-ghost btn-sm" disabled={pending} onClick={() => setStatus(ev, "cancelled")} data-testid="request-cancel">
                      Ακύρωση
                    </button>
                    <button className="btn-ghost btn-sm" disabled={pending} onClick={() => openEdit(ev)}>
                      Άνοιγμα
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="card p-2 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={{ pathname: base, query: { m: prevMonth } }} className="btn-secondary btn-sm num" aria-label="Προηγούμενος μήνας" title={monthLabel(prevMonth)}>
          ‹
        </Link>
        <Link href={{ pathname: base, query: { m: nextMonth } }} className="btn-secondary btn-sm num" aria-label="Επόμενος μήνας" title={monthLabel(nextMonth)}>
          ›
        </Link>
        <Link href={{ pathname: base, query: { m: today.slice(0, 7) } }} className="btn-ghost btn-sm">
          Σήμερα
        </Link>
        <div className="font-semibold text-lg ml-1" data-testid="month-label">
          {monthLabel(month)}
        </div>
        <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label="Υπόμνημα">
          {conf.types.map((t) => (
            <li key={t} className="inline-flex items-center gap-1">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_TYPE_DOT[t]}`} />
              {typeLabels[t]}
            </li>
          ))}
        </ul>
      </div>

      <div className="card overflow-hidden" data-testid="month-grid">
        <div className="hidden sm:grid print:grid grid-cols-7 bg-surface-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
          {WEEKDAYS_SHORT.map((d) => (
            <div key={d} className="px-2 py-2 text-center">
              {d}
            </div>
          ))}
        </div>
        {grid.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-1 sm:grid-cols-7 print:grid-cols-7">
            {week.map((iso) => {
              const inMonth = iso.startsWith(month);
              const isToday = iso === today;
              const list = byDay.get(iso) ?? [];
              const isExpanded = expanded[iso] === true;
              const hiddenCount = isExpanded ? 0 : Math.max(0, list.length - MAX_CHIPS);
              return (
                <div
                  key={iso}
                  role="button"
                  tabIndex={0}
                  aria-label={`${longDateLabel(iso)}: νέα εκδήλωση`}
                  data-date={iso}
                  onClick={() => openNew(iso)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openNew(iso);
                    }
                  }}
                  className={`cal-day min-w-0 p-1.5 border-t border-line sm:border-l sm:first:border-l-0 print:border-l print:first:border-l-0 cursor-pointer transition-colors hover:bg-surface min-h-12 sm:min-h-[104px] ${
                    inMonth ? "bg-surface-2" : "hidden sm:block print:block bg-surface/60 text-ink-3"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`num text-xs font-semibold inline-flex items-center justify-center h-6 min-w-6 rounded-full px-1 ${isToday ? "bg-brand text-white" : ""}`}>
                      {Number(iso.slice(8, 10))}
                    </span>
                    <span className="sm:hidden print:hidden text-xs text-ink-3">{WEEKDAYS_SHORT[weekdayMon(iso)]}</span>
                    {isToday && <span className="hidden sm:inline print:inline text-[10px] uppercase tracking-wide text-brand font-semibold">Σήμερα</span>}
                  </div>
                  {list.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {list.map((ev, i) => {
                        const cancelled = ev.status === "cancelled";
                        const overflow = i >= MAX_CHIPS && !isExpanded;
                        const badge = payBadge(ev.status, ev.pay);
                        const web = isWebRequest(ev);
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            data-event-id={ev.id}
                            data-status={ev.status}
                            data-pay={ev.pay.state}
                            title={`${timeRange(ev)} ${ev.title} · ${typeLabels[ev.type]} · ${statusLabels[ev.status]}${ev.areaName ? ` · ${ev.areaName}` : ""}${web ? " · Αίτημα από site" : ""}${
                              badge ? ` · ${badge.label}` : ""
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(ev);
                            }}
                            className={`${overflow ? "hidden print:block" : "block"} w-full min-w-0 overflow-hidden text-left rounded-md border px-1.5 py-0.5 text-[11px] leading-4 font-medium ${
                              cancelled ? CANCELLED_CHIP : EVENT_TYPE_CHIP[ev.type]
                            } ${web ? "border-dashed border-brand ring-1 ring-brand/40" : ""}`}
                          >
                            <span className="block truncate">
                              <span className="num">{ev.startTime}</span> {ev.title}
                              {ev.type === "party" && ev.party?.kids ? <span className="opacity-70"> · {ev.party.kids}π</span> : null}
                            </span>
                            {web && (
                              <span className="block truncate" data-testid="chip-web">
                                <span className="inline-block max-w-full truncate rounded bg-brand px-1 align-top text-[10px] font-semibold leading-[14px] text-white">🌐 Αίτημα από site</span>
                              </span>
                            )}
                            {badge && (
                              <span className="block truncate" data-testid="chip-pay">
                                <span className={`inline-block max-w-full truncate rounded px-1 align-top text-[10px] font-semibold leading-[14px] ${PAY_PILL[badge.tone]}`}>{badge.short}</span>
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          className="print:hidden text-[11px] text-ink-3 hover:text-ink font-medium px-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded((x) => ({ ...x, [iso]: true }));
                          }}
                        >
                          +{hiddenCount} ακόμη
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Section title="Επόμενες 30 ημέρες" className="print:hidden" flush>
        {upcoming.length ? (
          <ul className="divide-y divide-line" data-testid="upcoming-list">
            {upcoming.map((ev) => (
              <li key={ev.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4" data-event-id={ev.id}>
                <div className="sm:w-32 shrink-0 flex sm:block items-baseline gap-2">
                  <div className="font-semibold num">
                    {WEEKDAYS_SHORT[weekdayMon(ev.date)]} {fmtIsoDate(ev.date)}
                  </div>
                  <div className="text-xs text-ink-3 num">
                    {timeRange(ev)}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{ev.title}</span>
                    <Badge>
                      <span className={`inline-block h-2 w-2 rounded-full mr-1 ${EVENT_TYPE_DOT[ev.type]}`} />
                      {typeLabels[ev.type]}
                    </Badge>
                    <Badge tone={EVENT_STATUS_TONE[ev.status]}>{statusLabels[ev.status]}</Badge>
                    {isWebRequest(ev) && <Badge tone="brand">🌐 Αίτημα από site</Badge>}
                    {payBadgeOf(ev)}
                  </div>
                  <div className="text-xs text-ink-3 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {ev.type === "party" && ev.party ? (
                      <>
                        {ev.party.childName && (
                          <span>
                            🎂 {ev.party.childName}
                            {ev.party.childAge ? <span className="num"> ({ev.party.childAge} ετών)</span> : null}
                          </span>
                        )}
                        <span className="num">
                          {ev.party.kids ?? 0} παιδιά · {ev.party.adults ?? 0} ενήλικες
                        </span>
                        {packageByKey(ev.party.package) && <span>{packageByKey(ev.party.package)!.name}</span>}
                        {ev.party.cake && <span>Τούρτα: {ev.party.cake}</span>}
                      </>
                    ) : (
                      <span className="num">{ev.guests} άτομα</span>
                    )}
                    <span>{ev.areaName ?? "όλος ο χώρος"}</span>
                    {(ev.customerName || ev.customerPhone) && (
                      <span>
                        {ev.customerName}
                        {ev.customerPhone && <> · {phoneLink(ev.customerPhone)}</>}
                      </span>
                    )}
                    <span>
                      Τιμή <Money cents={ev.priceCents} />
                      {ev.pay.paidCents > 0 ? (
                        <>
                          {" "}
                          · εισπράχθηκαν <Money cents={ev.pay.paidCents} />
                        </>
                      ) : (
                        ev.depositCents > 0 && (
                          <>
                            {" "}
                            (συμφωνημένη προκ. <Money cents={ev.depositCents} />)
                          </>
                        )
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  {ev.status !== "confirmed" && ev.status !== "done" && (
                    <button className="btn-primary btn-sm" disabled={pending} onClick={() => setStatus(ev, "confirmed")}>
                      Επιβεβαίωση
                    </button>
                  )}
                  {ev.status === "confirmed" && (
                    <button className="btn-secondary btn-sm" disabled={pending} onClick={() => setStatus(ev, "done")}>
                      Ολοκληρώθηκε
                    </button>
                  )}
                  {ev.status !== "cancelled" && ev.status !== "done" && (
                    <button className="btn-ghost btn-sm" disabled={pending} onClick={() => setStatus(ev, "cancelled")}>
                      Ακύρωση
                    </button>
                  )}
                  <button className="btn-secondary btn-sm" disabled={pending} onClick={() => setPaying(ev)} data-testid="upcoming-pay">
                    💶 Πληρωμές
                  </button>
                  <button className="btn-ghost btn-sm" disabled={pending} onClick={() => openEdit(ev)}>
                    Επεξεργασία
                  </button>
                  <button className="btn-ghost btn-sm text-danger" disabled={pending} onClick={() => remove(ev)}>
                    Διαγραφή
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4 text-sm text-ink-3">Δεν υπάρχει τίποτα προγραμματισμένο τις επόμενες 30 ημέρες.</div>
        )}
      </Section>

      {scope === "parties" && <BirthdaysSection rows={birthdays} venueName={venueName} className="print:hidden" />}

      <EventPaymentsModal
        event={paying ? { id: paying.id, title: paying.title, date: paying.date, depositCents: paying.depositCents } : null}
        today={today}
        isAdmin={isAdmin}
        runner={runner}
        onClose={() => setPaying(null)}
      />

      <EventForm
        key={modalSeq}
        open={modal !== null}
        onClose={() => setModal(null)}
        initial={modal?.mode === "edit" ? modal.event : null}
        defaultDate={modal?.mode === "new" ? modal.date : today}
        areas={areas}
        typeLabels={typeLabels}
        statusLabels={statusLabels}
        allowedTypes={conf.types}
        defaultType={conf.newType}
        runner={runner}
        today={today}
        isAdmin={isAdmin}
        onSaved={() => setModal(null)}
      />
    </div>
  );
}
