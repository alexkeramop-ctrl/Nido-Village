import { requirePageUser } from "@/server/page-auth";
import { listModifierGroups } from "@/server/services/catalog";
import { ModifiersManager } from "./modifiers-manager";

export const dynamic = "force-dynamic";

export default async function ModifiersPage() {
  await requirePageUser("manager", "admin");
  const groups = await listModifierGroups(true);
  return (
    <ModifiersManager
      groups={groups.map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        active: g.active,
        modifiers: g.modifiers.map((m) => ({ id: m.id, groupId: m.groupId, name: m.name, priceDeltaCents: m.priceDeltaCents, sort: m.sort, active: m.active })),
      }))}
    />
  );
}
