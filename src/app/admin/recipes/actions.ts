"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { setRecipe } from "@/server/services/inventory";

export async function setRecipeAction(target: { productId: number } | { modifierId: number }, lines: { ingredientId: number; qty: number }[]) {
  return run(async () => {
    await requireRole("manager", "admin");
    const clean = lines.filter((l) => l.ingredientId > 0 && Number.isFinite(l.qty) && l.qty > 0);
    const ids = new Set(clean.map((l) => l.ingredientId));
    if (ids.size !== clean.length) throw new Error("Η ίδια πρώτη ύλη υπάρχει δύο φορές στη συνταγή");
    await setRecipe(target, clean);
    revalidatePath("/admin/recipes");
    revalidatePath("/admin/reports");
  });
}
