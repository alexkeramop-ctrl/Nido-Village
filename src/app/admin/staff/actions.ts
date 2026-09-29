"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { ROLE_LABEL, upsertEmployee } from "@/server/services/staff";
import type { EmployeeRole } from "@/db/schema";

export async function saveEmployeeAction(input: { id?: number; name: string; role: string; pin: string; active: boolean }) {
  return run(async () => {
    await requireRole("admin");
    if (!input.name.trim()) throw new Error("Απαιτείται όνομα");
    if (!(input.role in ROLE_LABEL)) throw new Error("Μη έγκυρος ρόλος");
    const pin = input.pin.trim();
    if (pin && !/^\d{4,8}$/.test(pin)) throw new Error("Το PIN πρέπει να έχει 4 έως 8 ψηφία");
    await upsertEmployee({ id: input.id, name: input.name.trim(), role: input.role as EmployeeRole, pin: pin || undefined, active: input.active });
    revalidatePath("/admin/staff");
  });
}
