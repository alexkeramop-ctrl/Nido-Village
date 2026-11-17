import { requirePageUser } from "@/server/page-auth";
import { listBookingsDue } from "@/server/services/booking-payments";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from "@/server/services/events";
import { todayAthens } from "@/server/services/reports";
import { getSettings } from "@/server/services/settings";
import { DueView } from "./due-view";

export const dynamic = "force-dynamic";

export default async function BookingsDuePage() {
  const user = await requirePageUser("manager", "admin");
  const [due, settings] = await Promise.all([listBookingsDue(), getSettings()]);
  return (
    <DueView
      rows={due.rows}
      totalCents={due.totalCents}
      overdueCents={due.overdueCents}
      overdueCount={due.overdueCount}
      today={todayAthens()}
      isAdmin={user.role === "admin"}
      venueName={settings.venueName}
      typeLabels={EVENT_TYPE_LABEL}
      statusLabels={EVENT_STATUS_LABEL}
    />
  );
}
