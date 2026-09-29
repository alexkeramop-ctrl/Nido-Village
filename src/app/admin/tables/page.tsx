import { requirePageUser } from "@/server/page-auth";
import { listAreas } from "@/server/services/floor";
import { TablesManager } from "./tables-manager";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  await requirePageUser("manager", "admin");
  const areas = await listAreas(true);
  return (
    <TablesManager
      areas={areas.map((a) => ({
        id: a.id,
        name: a.name,
        sort: a.sort,
        active: a.active,
        tables: a.tables.map((t) => ({ id: t.id, areaId: t.areaId, name: t.name, seats: t.seats, sort: t.sort, active: t.active })),
      }))}
    />
  );
}
