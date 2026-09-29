import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { getSessionDetail } from "@/server/services/billing";
import { getMenu } from "@/server/services/catalog";
import { getFloor } from "@/server/services/floor";
import { getSettings } from "@/server/services/settings";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { toSessionDto } from "@/components/ops/session-dto";
import { ORDER_TYPE_TITLE } from "@/components/ops/labels";
import { OrderScreen } from "../../order-screen";

export const dynamic = "force-dynamic";

/** PDA: οθόνη παραγγελίας ενός τραπεζιού / πακέτου. */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("kitchen", "waiter", "cashier", "manager", "admin");
  const { id } = await params;
  const sessionId = Number(id);
  const detail = Number.isInteger(sessionId) && sessionId > 0 ? await getSessionDetail(sessionId) : null;
  if (!detail) redirect("/pda");

  if (detail.status === "closed" || detail.status === "cancelled") {
    return (
      <Shell user={user} active="/pda" title={detail.displayName}>
        <main className="flex-1 p-4 flex items-start justify-center">
          <div className="card p-6 max-w-sm w-full text-center mt-8">
            <div className="text-lg font-semibold">Το τραπέζι έκλεισε</div>
            <p className="text-sm text-ink-3 mt-1">
              Η συνεδρία «{detail.displayName}» {detail.status === "cancelled" ? "ακυρώθηκε" : "έχει εξοφληθεί"}.
            </p>
            <Link href="/pda" className="btn-primary mt-4 w-full">
              Πίσω στα τραπέζια
            </Link>
          </div>
        </main>
      </Shell>
    );
  }

  const [menu, settings, floor] = await Promise.all([getMenu(), getSettings(), getFloor()]);
  const freeTables = floor.areas.flatMap((a) => a.tables.filter((t) => !t.session).map((t) => ({ id: t.id, name: t.name, area: a.name })));
  return (
    <Shell user={user} active="/pda" title={detail.orderType === "dine_in" ? detail.displayName : `${ORDER_TYPE_TITLE[detail.orderType]}: ${detail.displayName}`}>
      <LiveRefresh types={["session.changed", "catalog.changed"]} />
      <OrderScreen session={toSessionDto(detail)} menu={menu} courses={Math.max(1, Math.min(6, settings.courses || 1))} freeTables={freeTables} />
    </Shell>
  );
}
