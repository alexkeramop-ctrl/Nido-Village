import { requirePageUser } from "@/server/page-auth";
import { upcomingBirthdays } from "@/server/services/birthdays";
import { paymentTotalsByEvent, type PaymentTotals } from "@/server/services/booking-payments";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, listEvents, pendingWebsiteRequests, upcomingEvents } from "@/server/services/events";
import { listAreas } from "@/server/services/floor";
import { todayAthens } from "@/server/services/reports";
import { getSettings } from "@/server/services/settings";
import { summarizePayments } from "@/components/admin/bookings/meta";
import { MONTH_RE, monthGrid } from "@/components/admin/events/dates";
import type { EventRow } from "@/components/admin/events/types";
import { SCOPES, type CalendarScope } from "@/components/admin/events/meta";
import { EventsCalendar } from "./calendar";

export type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type DbEvent = Awaited<ReturnType<typeof listEvents>>[number];

function toRow(e: DbEvent, totals: Map<number, PaymentTotals>): EventRow {
  return {
    id: e.id,
    title: e.title,
    type: e.type,
    status: e.status,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    guests: e.guests,
    areaId: e.areaId,
    areaName: e.area?.name ?? null,
    customerName: e.customerName,
    customerPhone: e.customerPhone,
    customerEmail: e.customerEmail,
    priceCents: e.priceCents,
    depositCents: e.depositCents,
    menuNotes: e.menuNotes,
    notes: e.notes,
    party: e.party ?? null,
    source: e.source,
    pay: summarizePayments(e, totals.get(e.id)),
  };
}

/** Κοινή σελίδα για τα τρία ημερολόγια (όλα / γάμοι & βαπτίσεις / παιδικά πάρτι). */
export async function renderCalendar(scope: CalendarScope, { searchParams }: SP) {
  const user = await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const today = todayAthens();
  const m = one(sp.m);
  const month = m && MONTH_RE.test(m) ? m : today.slice(0, 7);
  const grid = monthGrid(month);
  const types = new Set(SCOPES[scope].types);
  const [allEvents, allUpcoming, allRequests, areas, settings, birthdays] = await Promise.all([
    listEvents(grid.from, grid.to, { includeCancelled: true }),
    upcomingEvents(30, 200),
    pendingWebsiteRequests(),
    listAreas(),
    getSettings(),
    // Τα γενέθλια αφορούν μόνο τα πάρτι: φαίνονται στο ημερολόγιο των πάρτι.
    scope === "parties" ? upcomingBirthdays(60, today) : Promise.resolve([]),
  ]);
  const events = allEvents.filter((e) => types.has(e.type));
  const upcoming = allUpcoming.filter((e) => types.has(e.type)).slice(0, 50);
  const requests = allRequests.filter((e) => types.has(e.type));
  // Εισπράξεις όλων των κρατήσεων που φαίνονται, με ένα ερώτημα.
  const totals = await paymentTotalsByEvent([...new Set([...events, ...upcoming, ...requests].map((e) => e.id))]);
  return (
    <EventsCalendar
      scope={scope}
      month={month}
      today={today}
      grid={grid}
      events={events.map((e) => toRow(e, totals))}
      upcoming={upcoming.map((e) => toRow(e, totals))}
      requests={requests.map((e) => toRow(e, totals))}
      birthdays={birthdays}
      areas={areas.map((a) => ({ id: a.id, name: a.name }))}
      typeLabels={EVENT_TYPE_LABEL}
      statusLabels={EVENT_STATUS_LABEL}
      isAdmin={user.role === "admin"}
      venueName={settings.venueName}
    />
  );
}
