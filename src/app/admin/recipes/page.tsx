import { requirePageUser } from "@/server/page-auth";
import { listModifierGroups, listProducts } from "@/server/services/catalog";
import { listIngredients, recipeCosts, UNIT_LABEL } from "@/server/services/inventory";
import { listRecipeLines } from "@/server/services/admin-extra";
import { RecipesManager } from "./recipes-manager";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  await requirePageUser("manager", "admin");
  const [products, groups, ingredients, costs, lines] = await Promise.all([listProducts(true), listModifierGroups(true), listIngredients(true), recipeCosts(), listRecipeLines()]);
  const byProduct = new Map<number, { ingredientId: number; qty: number }[]>();
  const byModifier = new Map<number, { ingredientId: number; qty: number }[]>();
  for (const l of lines) {
    if (l.productId) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), { ingredientId: l.ingredientId, qty: l.qty }]);
    else if (l.modifierId) byModifier.set(l.modifierId, [...(byModifier.get(l.modifierId) ?? []), { ingredientId: l.ingredientId, qty: l.qty }]);
  }
  return (
    <RecipesManager
      products={products.map((p) => {
        const costCents = costs.get(p.id) ?? 0;
        return {
          id: p.id,
          name: p.name,
          categoryName: p.category.name,
          categorySort: p.category.sort,
          priceCents: p.priceCents,
          costCents,
          active: p.active,
          lines: byProduct.get(p.id) ?? [],
        };
      })}
      modifiers={groups.flatMap((g) =>
        g.modifiers.map((m) => ({ id: m.id, name: m.name, groupName: g.name, priceDeltaCents: m.priceDeltaCents, active: m.active && g.active, lines: byModifier.get(m.id) ?? [] })),
      )}
      ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, unitLabel: UNIT_LABEL[i.unit], cost: i.cost, active: i.active }))}
    />
  );
}
