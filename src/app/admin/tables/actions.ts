"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { createTablesBatch, upsertArea, upsertTable } from "@/server/services/floor";

export async function saveAreaAction(input: { id?: number; name: string; sort: number; active: boolean }) {
  return run(async () => {
    await requireRole("manager", "admin");
    await upsertArea(input);
    revalidatePath("/admin/tables");
  });
}

export async function saveTableAction(input: { id?: number; areaId: number; name: string; seats: number; sort: number; active: boolean }) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!input.areaId) throw new Error("Επίλεξε χώρο");
    if (input.seats < 1) throw new Error("Οι θέσεις πρέπει να είναι τουλάχιστον 1");
    await upsertTable(input);
    revalidatePath("/admin/tables");
  });
}

export async function createTablesBatchAction(input: { areaId: number; prefix: string; from: number; to: number; seats: number }) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!input.areaId) throw new Error("Επίλεξε χώρο");
    if (input.from < 1 || input.to < input.from) throw new Error("Μη έγκυρο εύρος αριθμών");
    if (input.to - input.from > 200) throw new Error("Έως 200 τραπέζια τη φορά");
    const rows = await createTablesBatch(input.areaId, input.prefix.trim(), input.from, input.to, Math.max(1, input.seats));
    revalidatePath("/admin/tables");
    return rows.length;
  });
}
