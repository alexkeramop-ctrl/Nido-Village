import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { getSessionDetail } from "@/server/services/billing";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { toSessionDto } from "@/components/ops/session-dto";
import { ORDER_TYPE_TITLE } from "@/components/ops/labels";
import { PaymentScreen } from "../../payment-screen";

export const dynamic = "force-dynamic";

/** Ταμείο: λογαριασμός και πληρωμή μιας συνεδρίας. */
export default async function CashierSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("cashier", "manager", "admin");
  const { id } = await params;
  const sessionId = Number(id);
  const detail = Number.isInteger(sessionId) && sessionId > 0 ? await getSessionDetail(sessionId) : null;
  if (!detail) redirect("/cashier");
  return (
    <Shell user={user} active="/cashier" title={detail.orderType === "dine_in" ? detail.displayName : `${ORDER_TYPE_TITLE[detail.orderType]}: ${detail.displayName}`}>
      <LiveRefresh types={["session.changed"]} />
      <PaymentScreen session={toSessionDto(detail)} />
    </Shell>
  );
}
