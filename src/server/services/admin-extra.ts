/**
 * Μικρές πρόσθετες υπηρεσίες για το back-office (μόνο ανάγνωση).
 */
import { getDb } from "@/db";
import { num } from "@/server/money";

/** Όλες οι γραμμές συνταγών (προϊόντων και επιλογών) για τον επεξεργαστή συνταγών. */
export async function listRecipeLines() {
  const db = await getDb();
  const rows = await db.query.recipeLines.findMany();
  return rows.map((l) => ({ id: l.id, productId: l.productId, modifierId: l.modifierId, ingredientId: l.ingredientId, qty: num(l.qty) }));
}
