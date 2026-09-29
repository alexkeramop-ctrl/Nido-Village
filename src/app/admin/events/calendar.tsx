"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Money } from "@/components/ui";
import { PageHeader, Section, useActionRunner } from "@/components/admin/common";
import { fmtIsoDate } from "@/components/admin/format";
import { LiveRefresh } from "@/components/live";
import { WEEKDAYS_SHORT, longDateLabel, monthLabel, shiftMonth, weekdayMon, type MonthGrid } from "@/components/admin/events/dates";
import { CANCELLED_CHIP, EVENT_STATUS_TONE, EVENT_TYPES, EVENT_TYPE_CHIP, EVENT_TYPE_DOT } from "@/components/admin/events/meta";
import type { AreaOption, EventRow } from "@/components/admin/events/types";
import type { EventStatus, EventType } from "@/db/schema";
import { deleteEventAction, setEventStatusAction } from "./actions";
import { EventForm } from "./event-form";

type ModalState = { mode: "new"; date: string } | { mode: "edit"; event: EventRow } | null;

const MAX_CHIPS = 3;

export function EventsCalendar({
  month,
  today,
  grid,
  events,
  upcoming,
  areas,
  typeLabels,
  statusLabels,
}: {
  month: string;
  today: string;
  grid: MonthGrid;
  events: EventRow[];
  upcoming: EventRow[];
  areas: AreaOption[];
  typeLabels: Record<EventType, string>;
  statusLabels: Record<EventStatus, string>;
}) {
  const runner = useActionRunner();
  const { run, pending, toastElement } = runner;
  const [modal, setModal] = useState<ModalState>(null);
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
        title="Εκδηλώσεις"
        subtitle={`${monthLabel(month)} · ${inMonthCount} ${inMonthCount === 1 ? "εκδήλωση" : "εκδηλώσεις"} · γάμοι, βαφτίσεις, πάρτι, σχολικές εκδρομές, εταιρικά`}
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => window.print()}>
              Εκτύπωση μήνα
            </button>
            <button className="btn-primary btn-sm" onClick={() => openNew(today.startsWith(month) ? today : `${month}-01`)}>
              + Νέα εκδήλωση
            </button>
          </>
        }
      />

      <div className="card p-2 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={{ pathname: "/admin/events", query: { m: prevMonth } }} className="btn-secondary btn-sm num" aria-label="Προηγούμενος μήνας" title={monthLabel(prevMonth)}>
          ‹
        </Link>
        <Link href={{ pathname: "/admin/events", query: { m: nextMonth } }} className="btn-secondary btn-sm num" aria-label="Επόμενος μήνας" title={monthLabel(nextMonth)}>
          ›
        </Link>
        <Link href={{ pathname: "/admin/events", query: { m: today.slice(0, 7) } }} className="btn-ghost btn-sm">
          Σήμερα
        </Link>
        <div className="font-semibold text-lg ml-1" data-testid="month-label">
          {monthLabel(month)}
        </div>
        <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label="Υπόμνημα">
          {EVENT_TYPES.map((t) => (
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
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            data-event-id={ev.id}
                            data-status={ev.status}
                            title={`${ev.startTime}–${ev.endTime} ${ev.title} · ${typeLabels[ev.type]} · ${statusLabels[ev.status]}${ev.areaName ? ` · ${ev.areaName}` : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(ev);
                            }}
                            className={`${overflow ? "hidden print:block" : "block"} w-full text-left truncate rounded-md border px-1.5 py-0.5 text-[11px] leading-4 font-medium ${
                              cancelled ? CANCELLED_CHIP : EVENT_TYPE_CHIP[ev.type]
                            }`}
                          >
                            <span className="num">{ev.startTime}</span> {ev.title}
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
                    {ev.startTime}–{ev.endTime}
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
                    {ev.depositPaid && <Badge tone="ok">Προκαταβολή ✓</Badge>}
                  </div>
                  <div className="text-xs text-ink-3 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="num">{ev.guests} άτομα</span>
                    <span>{ev.areaName ?? "όλος ο χώρος"}</span>
                    {(ev.customerName || ev.customerPhone) && (
                      <span>
                        {ev.customerName}
                        {ev.customerPhone && <span className="num"> · {ev.customerPhone}</span>}
                      </span>
                    )}
                    <span>
                      <Money cents={ev.priceCents} />
                      {ev.depositCents > 0 && (
                        <>
                          {" "}
                          (προκ. <Money cents={ev.depositCents} />)
                        </>
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
          <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν προγραμματισμένες εκδηλώσεις τις επόμενες 30 ημέρες.</div>
        )}
      </Section>

      <EventForm
        key={modalSeq}
        open={modal !== null}
        onClose={() => setModal(null)}
        initial={modal?.mode === "edit" ? modal.event : null}
        defaultDate={modal?.mode === "new" ? modal.date : today}
        areas={areas}
        typeLabels={typeLabels}
        statusLabels={statusLabels}
        runner={runner}
        onSaved={() => setModal(null)}
      />
    </div>
  );
}
