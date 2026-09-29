import { requirePageUser } from "@/server/page-auth";
import { getFloor } from "@/server/services/floor";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { FloorScreen } from "./floor";

export const dynamic = "force-dynamic";

/** PDA: η κάτοψη με τα τραπέζια και τα πακέτα. */
export default async function PdaPage() {
  const user = await requirePageUser("waiter", "cashier", "manager", "admin");
  const floor = await getFloor();
  return (
    <Shell user={user} active="/pda" title="Τραπέζια">
      <LiveRefresh types={["floor.changed"]} pollMs={60000} />
      <FloorScreen
        areas={floor.areas.map((a) => ({
          id: a.id,
          name: a.name,
          tables: a.tables.map((t) => ({
            id: t.id,
            name: t.name,
            seats: t.seats,
            session: t.session ? { ...t.session, openedAt: t.session.openedAt.toISOString() } : null,
          })),
        }))}
        takeaway={floor.takeaway.map((s) => ({ ...s, openedAt: s.openedAt.toISOString() }))}
      />
    </Shell>
  );
}
