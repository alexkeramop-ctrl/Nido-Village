"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { upsertPartnerUser } from "@/server/services/partners";

export async function savePartnerAction(input: { id?: number; name: string; email: string; password: string; active: boolean }) {
  return run(async () => {
    await requireRole("admin");
    if (!input.name.trim()) throw new Error("Απαιτείται όνομα");
    await upsertPartnerUser({ id: input.id, name: input.name, email: input.email, password: input.password || undefined, active: input.active });
    revalidatePath("/admin/partners");
  });
}
