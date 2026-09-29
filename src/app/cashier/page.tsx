import { requirePageUser } from "@/server/page-auth";
import { cashSessionSummary, getCurrentCashSession, listRecentClosedSessions, listSessionsForCashier } from "@/server/services/billing";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { minutesSince } from "@/components/ops/labels";
import { CashierScreen } from "./cashier-screen";

export const dynamic = "force-dynamic";

/** Ταμείο: ανοιχτοί λογαριασμοί και βάρδια ταμείου. */
export default async function CashierPage() {
  const user = await requirePageUser("cashier", "manager", "admin");
  const [sessions, cash, recent] = await Promise.all([listSessionsForCashier(), getCurrentCashSession(), listRecentClosedSessions(10)]);
  const summary = cash ? await cashSessionSummary(cash.id) : null;
  return (
    <Shell user={user} active="/cashier" title="Ταμείο">
      <LiveRefresh types={["session.changed", "floor.changed"]} pollMs={60000} />
      <CashierScreen
        sessions={sessions.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          orderType: s.orderType,
          status: s.status,
          waiter: s.waiter,
          openedAt: s.openedAt.toISOString(),
          minutesOpen: minutesSince(s.openedAt),
          itemCount: s.itemCount,
          source: s.source,
          pickupCode: s.pickupCode,
          customerName: s.customerName,
          readyAt: s.readyAt?.toISOString() ?? null,
          pickedUpAt: s.pickedUpAt?.toISOString() ?? null,
          totals: {
            subtotalCents: s.totals.subtotalCents,
            discountCents: s.totals.discountCents,
            totalCents: s.totals.totalCents,
            paidCents: s.totals.paidCents,
            dueCents: s.totals.dueCents,
          },
        }))}
        shift={
          cash && summary
            ? {
                id: cash.id,
                openedAt: cash.openedAt.toISOString(),
                openingFloatCents: cash.openingFloatCents,
                byMethod: summary.byMethod,
                expectedCashCents: summary.expectedCashCents,
                totalCents: summary.totalCents,
              }
            : null
        }
        recent={recent.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          closedAt: r.closedAt ? r.closedAt.toISOString() : null,
          waiter: r.waiter,
          totalCents: r.totals.totalCents,
          methods: r.methods,
        }))}
      />
    </Shell>
  );
}
