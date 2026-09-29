import { LiveRefresh } from "@/components/live";
import { requirePageUser } from "@/server/page-auth";
import { listPrintJobs, listStations, STATION_KIND_LABEL } from "@/server/services/printers";
import { PrintersManager } from "./printers-manager";

export const dynamic = "force-dynamic";

export default async function PrintersPage() {
  await requirePageUser("manager", "admin");
  const [stations, jobs] = await Promise.all([listStations(), listPrintJobs({ limit: 50 })]);
  return (
    <>
      <LiveRefresh types={["print.changed", "printer.status"]} />
      <PrintersManager
        stations={stations.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          kindLabel: STATION_KIND_LABEL[s.kind],
          driver: s.driver,
          host: s.host,
          port: s.port,
          codepage: s.codepage,
          columns: s.columns,
          cutter: s.cutter,
          drawerKick: s.drawerKick,
          enabled: s.enabled,
          sort: s.sort,
          lastOkAt: s.lastOkAt?.toISOString() ?? null,
          lastError: s.lastError,
        }))}
        jobs={jobs.map((j) => ({
          id: j.id,
          stationName: j.station.name,
          kind: j.kind,
          status: j.status,
          attempts: j.attempts,
          lastError: j.lastError,
          createdAt: j.createdAt.toISOString(),
          printedAt: j.printedAt?.toISOString() ?? null,
          renderedText: j.renderedText,
        }))}
        kinds={Object.entries(STATION_KIND_LABEL).map(([value, label]) => ({ value, label }))}
      />
    </>
  );
}
