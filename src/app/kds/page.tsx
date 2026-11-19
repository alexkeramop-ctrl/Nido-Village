import { requirePageUser } from "@/server/page-auth";
import { listStations } from "@/server/services/printers";
import { getKdsTickets } from "@/server/services/ordering";
import { listReadyForPickup } from "@/server/services/public-order";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import { KdsScreen } from "./kds-screen";

export const dynamic = "force-dynamic";

/** Οθόνη κουζίνας & μπαρ (KDS). ?station=<id>|all. Το «ΕΤΟΙΜΟ» είναι το σήμα για να χτυπήσει ο βομβητής του πελάτη. */
export default async function KdsPage({ searchParams }: { searchParams: Promise<{ station?: string | string[] }> }) {
  const user = await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const raw = Array.isArray(sp.station) ? sp.station[0] : sp.station;
  const stations = (await listStations(false)).filter((s) => s.kind === "kitchen" || s.kind === "bar");
  const wanted = raw && raw !== "all" ? Number(raw) : null;
  const stationId = wanted && stations.some((s) => s.id === wanted) ? wanted : null;
  const [tickets, ready] = await Promise.all([getKdsTickets(stationId), listReadyForPickup()]);
  return (
    <Shell user={user} active="/kds" dark title="Κουζίνα & Μπαρ">
      {/* Στο Cloudflare δεν υπάρχει ζωντανή σύνδεση: ανανέωση κάθε 5″ ώστε η νέα παραγγελία να φαίνεται αμέσως. */}
      <LiveRefresh types={["kds.changed", "session.changed"]} pollMs={5000} />
      <KdsScreen
        stations={stations.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
        stationId={stationId}
        tickets={tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
        ready={ready}
      />
    </Shell>
  );
}
