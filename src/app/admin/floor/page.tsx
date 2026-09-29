import { requirePageUser } from "@/server/page-auth";
import { getAssetMeta } from "@/server/services/assets";
import { listAreas } from "@/server/services/floor";
import { FloorEditor, type EditorArea } from "./floor-editor";

export const dynamic = "force-dynamic";

/** Διαχείριση: επεξεργάσιμος χάρτης χώρου (θέσεις τραπεζιών πάνω σε εικόνα). */
export default async function FloorPage() {
  await requirePageUser("manager", "admin");
  const areas = (await listAreas(true)).filter((a) => a.active);
  const images = new Map<number, EditorArea["image"]>();
  for (const a of areas) {
    if (a.mapAssetId === null || images.has(a.mapAssetId)) continue;
    const meta = await getAssetMeta(a.mapAssetId);
    images.set(a.mapAssetId, meta ? { url: `/api/assets/${meta.id}`, width: meta.width, height: meta.height } : null);
  }
  return (
    <FloorEditor
      areas={areas.map((a) => ({
        id: a.id,
        name: a.name,
        image: a.mapAssetId === null ? null : (images.get(a.mapAssetId) ?? null),
        tables: a.tables
          .filter((t) => t.active)
          .map((t) => ({ id: t.id, name: t.name, seats: t.seats, posX: t.posX, posY: t.posY, shape: t.shape })),
      }))}
    />
  );
}
