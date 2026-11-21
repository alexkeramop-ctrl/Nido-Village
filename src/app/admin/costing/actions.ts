"use server";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { audit } from "@/server/audit";
import { setRecipe, upsertIngredient } from "@/server/services/inventory";
import { saveSettings } from "@/server/services/settings";
import { saveResaleItems } from "@/server/services/costing";
import type { StockUnit } from "@/db/schema";

const UNITS: StockUnit[] = ["g", "kg", "ml", "l", "pcs"];

function revalidateCosting() {
  revalidatePath("/admin/costing");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/inventory");
}

/** Αποθηκεύει τη συνταγή ενός προϊόντος (αντικαθιστά όλες τις γραμμές του). */
export async function saveRecipeAction(productId: number, lines: { ingredientId: number; qty: number }[]) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    const db = await getDb();
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
    if (!product) throw new Error("Το προϊόν δεν βρέθηκε");
    const clean = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0 && Number.isInteger(l.ingredientId) && l.ingredientId > 0);
    if (clean.some((l) => l.qty > 100000)) throw new Error("Η ποσότητα είναι υπερβολικά μεγάλη. Έλεγξε τη μονάδα μέτρησης.");
    const ids = [...new Set(clean.map((l) => l.ingredientId))];
    if (ids.length !== clean.length) throw new Error("Η ίδια πρώτη ύλη υπάρχει δύο φορές. Ένωσε τις ποσότητες σε μία γραμμή.");
    if (ids.length) {
      const found = await db.select({ id: schema.ingredients.id }).from(schema.ingredients).where(inArray(schema.ingredients.id, ids));
      if (found.length !== ids.length) throw new Error("Κάποια πρώτη ύλη δεν βρέθηκε. Ανανέωσε τη σελίδα.");
    }
    await setRecipe({ productId }, clean);
    await audit(db, me.id, "recipe_set", "product", productId, { lines: clean.length });
    revalidateCosting();
  });
}

/** Νέα πρώτη ύλη από τη σελίδα κοστολόγησης: τιμή συσκευασίας χωρίς ΦΠΑ και μέγεθος συσκευασίας. */
export async function quickIngredientAction(input: { name: string; unit: string; packSize: number; packPriceEuro: number; packName?: string | null }) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!UNITS.includes(input.unit as StockUnit)) throw new Error("Μη έγκυρη μονάδα μέτρησης");
    if (!input.name.trim()) throw new Error("Γράψε όνομα πρώτης ύλης");
    if (!(input.packSize > 0)) throw new Error("Γράψε πόσο έχει η συσκευασία (π.χ. 1000 για 1 κιλό σε γραμμάρια)");
    if (!(input.packPriceEuro >= 0)) throw new Error("Μη έγκυρη τιμή συσκευασίας");
    const row = await upsertIngredient({
      name: input.name,
      unit: input.unit as StockUnit,
      costPerUnit: input.packPriceEuro / input.packSize,
      packSize: input.packSize,
      packName: input.packName ?? null,
    });
    revalidateCosting();
    return { id: row.id };
  });
}

export async function saveCostTargetsAction(foodPct: number, drinkPct: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    for (const v of [foodPct, drinkPct]) if (!(v > 0 && v < 100)) throw new Error("Ο στόχος πρέπει να είναι από 1% έως 99%");
    await saveSettings({ foodCostTargetPct: Math.round(foodPct * 10) / 10, drinkCostTargetPct: Math.round(drinkPct * 10) / 10 });
    revalidateCosting();
  });
}

/** Έτοιμα προϊόντα: τιμή αγοράς ανά τεμάχιο αντί για συνταγή (βλ. saveResaleItems). */
export async function saveResaleItemsAction(items: { productId: number; unitCostEuro: number | null }[]) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    const list = (Array.isArray(items) ? items : []).slice(0, 300).map((i) => ({ productId: Number(i?.productId), unitCostEuro: i?.unitCostEuro === null ? null : Number(i?.unitCostEuro) }));
    const r = await saveResaleItems(list, me.id);
    revalidateCosting();
    return r;
  });
}
