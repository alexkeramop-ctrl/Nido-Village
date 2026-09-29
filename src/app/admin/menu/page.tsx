import { requirePageUser } from "@/server/page-auth";
import { listCategories, listModifierGroups, listProducts, listVatRates } from "@/server/services/catalog";
import { listStations } from "@/server/services/printers";
import { MenuManager } from "./menu-manager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  await requirePageUser("manager", "admin");
  const [categories, products, stations, vatRates, groups] = await Promise.all([
    listCategories(true),
    listProducts(true),
    listStations(),
    listVatRates(),
    listModifierGroups(true),
  ]);
  return (
    <MenuManager
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        sort: c.sort,
        color: c.color,
        printStationId: c.printStationId,
        stationName: c.printStation?.name ?? null,
        active: c.active,
      }))}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        categoryId: p.categoryId,
        categoryName: p.category.name,
        priceCents: p.priceCents,
        vatRateId: p.vatRateId,
        vatLabel: `${Number(p.vatRate.ratePct)}%`,
        printStationId: p.printStationId,
        stationName: p.printStation?.name ?? null,
        sku: p.sku,
        available: p.available,
        active: p.active,
        sort: p.sort,
        groupIds: p.modifierGroups.map((g) => g.groupId),
        groupNames: p.modifierGroups.map((g) => g.group.name),
      }))}
      stations={stations.map((s) => ({ id: s.id, name: s.name }))}
      vatRates={vatRates.filter((v) => v.active).map((v) => ({ id: v.id, name: v.name, ratePct: Number(v.ratePct) }))}
      groups={groups.map((g) => ({ id: g.id, name: g.name, active: g.active }))}
    />
  );
}
