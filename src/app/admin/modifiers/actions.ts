"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { parseEuroToCents } from "@/server/money";
import { upsertModifier, upsertModifierGroup } from "@/server/services/catalog";

export async function saveGroupAction(input: { id?: number; name: string; minSelect: number; maxSelect: number; active: boolean }) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (input.minSelect < 0 || input.maxSelect < 1) throw new Error("Μη έγκυρα όρια επιλογών");
    if (input.minSelect > input.maxSelect) throw new Error("Το ελάχιστο δεν μπορεί να υπερβαίνει το μέγιστο");
    await upsertModifierGroup(input);
    revalidatePath("/admin/modifiers");
    revalidatePath("/admin/menu");
  });
}

export async function saveModifierAction(input: { id?: number; groupId: number; name: string; priceDelta: string; sort: number; active: boolean }) {
  return run(async () => {
    await requireRole("manager", "admin");
    await upsertModifier({
      id: input.id,
      groupId: input.groupId,
      name: input.name,
      priceDeltaCents: input.priceDelta.trim() ? parseEuroToCents(input.priceDelta) : 0,
      sort: input.sort,
      active: input.active,
    });
    revalidatePath("/admin/modifiers");
    revalidatePath("/admin/recipes");
  });
}
