import { requirePageUser } from "@/server/page-auth";
import { getAssetMeta } from "@/server/services/assets";
import { getFloor } from "@/server/services/floor";
import { Shell } from "@/components/shell";
import { LiveRefresh } from "@/components/live";
import type { FloorMapImage } from "@/components/floor-map";
import { FloorScreen } from "./floor";

export const dynamic = "force-dynamic";

/** PDA: η κάτοψη (χάρτης ή λίστα) με τα τραπέζια και τα πακέτα. */
export default async function PdaPage() {
  const user = await requirePageUser("waiter", "cashier", "manager", "admin");
  const floor = await getFloor();
  const images = new Map<number, FloorMapImage>();
  for (const a of floor.areas) {
    if (a.mapAssetId === null || images.has(a.mapAssetId)) continue;
    const meta = await getAssetMeta(a.mapAssetId);
    images.set(a.mapAssetId, meta ? { url: `/api/assets/${meta.id}`, width: meta.width, height: meta.height } : null);
  }
  return (
    <Shell user={user} active="/pda" title="Τραπέζια">
      <LiveRefresh types={["floor.changed"]} pollMs={60000} />
      <FloorScreen
        areas={floor.areas.map((a) => ({
          id: a.id,
          name: a.name,
          image: a.mapAssetId === null ? null : (images.get(a.mapAssetId) ?? null),
          tables: a.tables.map((t) => ({
            id: t.id,
            name: t.name,
            seats: t.seats,
            posX: t.posX,
            posY: t.posY,
            shape: t.shape,
            session: t.session ? { ...t.session, openedAt: t.session.openedAt.toISOString() } : null,
          })),
        }))}
        takeaway={floor.takeaway.map((s) => ({ ...s, openedAt: s.openedAt.toISOString() }))}
      />
    </Shell>
  );
}
