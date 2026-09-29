import { requirePageUser } from "@/server/page-auth";
import { listAreas } from "@/server/services/floor";
import { listStations } from "@/server/services/printers";
import { TablesManager } from "./tables-manager";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  await requirePageUser("manager", "admin");
  const [areas, stations] = await Promise.all([listAreas(true), listStations(false)]);
  const bars = stations.filter((s) => s.kind === "bar").map((s) => ({ id: s.id, name: s.name }));
  return (
    <TablesManager
      bars={bars}
      areas={areas.map((a) => ({
        id: a.id,
        name: a.name,
        sort: a.sort,
        active: a.active,
        barStationId: a.barStationId,
        barName: stations.find((s) => s.id === a.barStationId)?.name ?? null,
        tables: a.tables.map((t) => ({ id: t.id, areaId: t.areaId, name: t.name, seats: t.seats, sort: t.sort, active: t.active })),
      }))}
    />
  );
}
