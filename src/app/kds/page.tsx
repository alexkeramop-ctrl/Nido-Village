import { requirePageUser } from "@/server/page-auth";
import { listStations } from "@/server/services/printers";
import { getKdsTickets } from "@/server/services/ordering";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { KdsScreen } from "./kds-screen";

export const dynamic = "force-dynamic";

/** Οθόνη κουζίνας (KDS). ?station=<id>|all */
export default async function KdsPage({ searchParams }: { searchParams: Promise<{ station?: string | string[] }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const raw = Array.isArray(sp.station) ? sp.station[0] : sp.station;
  const stations = (await listStations(false)).filter((s) => s.kind === "kitchen" || s.kind === "bar");
  const wanted = raw && raw !== "all" ? Number(raw) : null;
  const stationId = wanted && stations.some((s) => s.id === wanted) ? wanted : null;
  const tickets = await getKdsTickets(stationId);
  return (
    <Shell user={user} active="/kds" dark title="Κουζίνα">
      <LiveRefresh types={["kds.changed"]} pollMs={30000} />
      <KdsScreen
        stations={stations.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
        stationId={stationId}
        tickets={tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
      />
    </Shell>
  );
}
