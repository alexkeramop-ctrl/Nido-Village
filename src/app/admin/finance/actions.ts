"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { deleteFinanceEntry, upsertFinanceEntry, type FinanceInput } from "@/server/services/finance";

function revalidate() {
  revalidatePath("/admin/finance");
  revalidatePath("/admin");
}

export async function saveFinanceEntryAction(input: FinanceInput) {
  return run(async () => {
    const me = await requireRole("admin");
    const row = await upsertFinanceEntry(input, me.id);
    revalidate();
    return row.id;
  });
}

export async function deleteFinanceEntryAction(id: number) {
  return run(async () => {
    const me = await requireRole("admin");
    await deleteFinanceEntry(id, me.id);
    revalidate();
  });
}
