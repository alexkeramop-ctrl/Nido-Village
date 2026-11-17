"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, EmptyState, Money } from "@/components/ui";
import { InfoBox, PageHeader, Section, TableWrap, useActionRunner } from "@/components/admin/common";
import { fmtIsoDate } from "@/components/admin/format";
import { LiveRefresh } from "@/components/live";
import { EVENT_STATUS_TONE, EVENT_TYPE_DOT, SCOPES } from "@/components/admin/events/meta";
import { dueReminderText, type DueRow } from "@/components/admin/bookings/meta";
import { EventPaymentsModal } from "@/components/admin/bookings/event-payments";
import { formatPhone, telHref, whatsappHref } from "@/lib/phone";
import type { EventStatus, EventType } from "@/db/schema";

type Filter = "all" | "overdue" | "upcoming";

function whenLabel(days: number): string {
  if (days === 0) return "σήμερα";
  if (days === 1) return "αύριο";
  if (days === -1) return "χθες";
  return days > 0 ? `σε ${days} ημέρες` : `πριν ${-days} ημέρες`;
}

/** Το ημερολόγιο στο οποίο ανήκει η κράτηση (για τον σύνδεσμο «άνοιγμα στο ημερολόγιο»). */
function calendarHref(row: DueRow): string {
  const path = row.type === "party" ? SCOPES.parties.path : SCOPES.ceremonies.types.includes(row.type) ? SCOPES.ceremonies.path : SCOPES.all.path;
  return `${path}?m=${row.date.slice(0, 7)}`;
}

export function DueView({
  rows,
  totalCents,
  overdueCents,
  overdueCount,
  today,
  isAdmin,
  venueName,
  typeLabels,
  statusLabels,
}: {
  rows: DueRow[];
  totalCents: number;
  overdueCents: number;
  overdueCount: number;
  today: string;
  isAdmin: boolean;
  venueName: string;
  typeLabels: Record<EventType, string>;
  statusLabels: Record<EventStatus, string>;
}) {
  const runner = useActionRunner();
  const [filter, setFilter] = useState<Filter>("all");
  const [paying, setPaying] = useState<DueRow | null>(null);
  const shown = rows.filter((r) => (filter === "overdue" ? r.daysUntil < 0 : filter === "upcoming" ? r.daysUntil >= 0 : true));
  const shownTotal = shown.reduce((a, r) => a + r.pay.balanceCents, 0);
  const inquiries = rows.filter((r) => r.status === "inquiry");
  const inquiriesCents = inquiries.reduce((a, r) => a + r.pay.balanceCents, 0);

  const contact = (r: DueRow) => {
    const tel = telHref(r.customerPhone);
    const wa = whatsappHref(r.customerPhone, dueReminderText({ typeLabel: typeLabels[r.type], date: r.date, balanceCents: r.pay.balanceCents }, venueName));
    return { tel, wa };
  };

  const actions = (r: DueRow) => {
    const { tel, wa } = contact(r);
    return (
      <div className="flex flex-wrap gap-1.5">
        {tel && (
          <a href={tel} className="btn-secondary btn-sm" data-testid="due-tel" aria-label={`Κλήση ${r.customerName || r.title}`}>
            📞 Κλήση
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary btn-sm" data-testid="due-whatsapp" aria-label={`Υπενθύμιση στο WhatsApp: ${r.customerName || r.title}`}>
            💬 WhatsApp
          </a>
        )}
        <button className="btn-primary btn-sm" onClick={() => setPaying(r)} data-testid="due-pay">
          💶 Πληρωμή
        </button>
      </div>
    );
  };

  const badges = (r: DueRow) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge>
        <span className={`inline-block h-2 w-2 rounded-full mr-1 ${EVENT_TYPE_DOT[r.type]}`} />
        {typeLabels[r.type]}
      </Badge>
      <Badge tone={EVENT_STATUS_TONE[r.status]}>{statusLabels[r.status]}</Badge>
      {r.pay.paidCents === 0 && r.status === "confirmed" && <Badge tone="danger">Χωρίς προκαταβολή</Badge>}
    </span>
  );

  return (
    <div className="space-y-4">
      {runner.toastElement}
      <LiveRefresh types={["catalog.changed"]} />
      <PageHeader title="Οφειλές κρατήσεων" subtitle="Κρατήσεις που δεν έχουν εξοφληθεί, με σειρά ημερομηνίας. Οι ακυρωμένες δεν εμφανίζονται." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4" data-testid="due-total">
          <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">Συνολικό υπόλοιπο</div>
          <div className="text-2xl font-bold mt-1 num">
            <Money cents={totalCents} />
          </div>
          <div className="text-xs text-ink-3 mt-1">
            σε {rows.length} {rows.length === 1 ? "κράτηση" : "κρατήσεις"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">Έχουν ήδη γίνει</div>
          <div className={`text-2xl font-bold mt-1 num ${overdueCents > 0 ? "text-danger" : ""}`}>
            <Money cents={overdueCents} />
          </div>
          <div className="text-xs text-ink-3 mt-1">
            {overdueCount} {overdueCount === 1 ? "κράτηση πέρασε" : "κρατήσεις πέρασαν"} χωρίς εξόφληση
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">Επόμενες κρατήσεις</div>
          <div className="text-2xl font-bold mt-1 num">
            <Money cents={totalCents - overdueCents} />
          </div>
          <div className="text-xs text-ink-3 mt-1">
            {rows.length - overdueCount} {rows.length - overdueCount === 1 ? "κράτηση" : "κρατήσεις"} από σήμερα και μετά
          </div>
        </div>
      </div>

      {inquiries.length > 0 && (
        <InfoBox>
          Από το σύνολο, <Money cents={inquiriesCents} className="font-semibold" /> είναι σε {inquiries.length} {inquiries.length === 1 ? "αίτημα" : "αιτήματα"} που δεν έχουν επιβεβαιωθεί ακόμη. Αν ένα αίτημα δεν προχώρησε,
          ακύρωσέ το στο ημερολόγιο για να φύγει από τις οφειλές.
        </InfoBox>
      )}

      <Section
        flush
        title={
          <span>
            Κρατήσεις με υπόλοιπο{" "}
            <span className="text-ink-3 font-normal num">
              · {shown.length} · <Money cents={shownTotal} />
            </span>
          </span>
        }
        actions={
          <div className="flex gap-1" role="group" aria-label="Φίλτρο">
            {(
              [
                ["all", "Όλες"],
                ["overdue", "Έχουν γίνει"],
                ["upcoming", "Επόμενες"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`btn-sm ${filter === k ? "btn-primary" : "btn-secondary"}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState title={rows.length ? "Καμία κράτηση σε αυτό το φίλτρο" : "Καμία οφειλή 🎉"} hint={rows.length ? undefined : "Όλες οι κρατήσεις με τιμή έχουν εξοφληθεί."} />
          </div>
        ) : (
          <>
            {/* Κινητό: κάρτες */}
            <ul className="md:hidden divide-y divide-line" data-testid="due-cards">
              {shown.map((r) => (
                <li key={r.id} className="p-4 space-y-2" data-event-id={r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold break-words">{r.title}</div>
                      <div className="text-xs text-ink-3 num">
                        {fmtIsoDate(r.date)} · <span className={r.daysUntil < 0 ? "text-danger font-semibold" : ""}>{whenLabel(r.daysUntil)}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Υπόλοιπο</div>
                      <Money cents={r.pay.balanceCents} className="text-lg font-bold text-danger" />
                    </div>
                  </div>
                  {badges(r)}
                  <div className="text-sm text-ink-2">
                    {r.customerName || "—"}
                    {r.customerPhone && <span className="num"> · {formatPhone(r.customerPhone)}</span>}
                  </div>
                  <div className="text-xs text-ink-3 num">
                    Τιμή <Money cents={r.pay.priceCents} /> · εισπράχθηκαν <Money cents={r.pay.paidCents} />
                  </div>
                  {actions(r)}
                </li>
              ))}
            </ul>
            {/* Υπολογιστής/tablet: πίνακας με ταξινόμηση */}
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th>Ημερομηνία</th>
                    <th>Κράτηση</th>
                    <th>Πελάτης</th>
                    <th className="text-right">Τιμή</th>
                    <th className="text-right">Εισπράχθηκαν</th>
                    <th className="text-right">Υπόλοιπο</th>
                    <th data-nosort></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} data-event-id={r.id}>
                      <td className="num whitespace-nowrap">
                        {fmtIsoDate(r.date)}
                        <div className={`text-xs ${r.daysUntil < 0 ? "text-danger font-semibold" : "text-ink-3"}`}>{whenLabel(r.daysUntil)}</div>
                      </td>
                      <td>
                        <Link href={calendarHref(r)} className="font-medium hover:underline" title="Άνοιγμα στο ημερολόγιο">
                          {r.title}
                        </Link>
                        <div className="mt-1">{badges(r)}</div>
                      </td>
                      <td>
                        {r.customerName || <span className="text-ink-3">—</span>}
                        {r.customerPhone && (
                          <div className="text-xs num">
                            {telHref(r.customerPhone) ? (
                              <a href={telHref(r.customerPhone)!} className="text-ink-2 hover:underline">
                                {formatPhone(r.customerPhone)}
                              </a>
                            ) : (
                              <span className="text-ink-3">{r.customerPhone}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="text-right num whitespace-nowrap">
                        <Money cents={r.pay.priceCents} />
                      </td>
                      <td className="text-right num whitespace-nowrap">
                        <Money cents={r.pay.paidCents} />
                      </td>
                      <td className="text-right num whitespace-nowrap font-semibold text-danger">
                        <Money cents={r.pay.balanceCents} />
                      </td>
                      <td>{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="text-right font-semibold">
                      Σύνολο
                    </td>
                    <td className="text-right num font-bold" data-testid="due-shown-total">
                      <Money cents={shownTotal} />
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </TableWrap>
            </div>
          </>
        )}
      </Section>

      <EventPaymentsModal event={paying ? { id: paying.id, title: paying.title, date: paying.date, depositCents: paying.depositCents } : null} today={today} isAdmin={isAdmin} runner={runner} onClose={() => setPaying(null)} />
    </div>
  );
}
