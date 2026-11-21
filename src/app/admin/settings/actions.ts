"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { upsertVatRate } from "@/server/services/catalog";
import { saveSettings } from "@/server/services/settings";
import { upsertRegister } from "@/server/services/registers";

export async function saveSettingsAction(input: { venueName: string; vatNumber: string; taxOffice: string; address: string; phone: string; email: string; courses: number }) {
  return run(async () => {
    await requireRole("admin");
    if (!input.venueName.trim()) throw new Error("Απαιτείται επωνυμία");
    const email = String(input.email ?? "").trim().slice(0, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("Μη έγκυρο email");
    const courses = Math.min(5, Math.max(1, Math.round(input.courses)));
    await saveSettings({
      venueName: input.venueName.trim(),
      vatNumber: input.vatNumber.trim(),
      taxOffice: input.taxOffice.trim(),
      address: input.address.trim(),
      phone: input.phone.trim(),
      email,
      courses,
    });
    revalidatePath("/admin/settings");
    revalidatePath("/order");
  });
}

export async function saveRegisterAction(input: { id?: number; name: string; sort?: number; active: boolean; areaId?: number | null }) {
  return run(async () => {
    const user = await requireRole("admin");
    const areaId = input.areaId === undefined ? undefined : Number.isInteger(input.areaId) && Number(input.areaId) > 0 ? Number(input.areaId) : null;
    await upsertRegister({ id: input.id, name: String(input.name ?? ""), sort: Number.isFinite(input.sort) ? input.sort : undefined, active: !!input.active, areaId }, user.id);
    revalidatePath("/admin/settings");
    revalidatePath("/cashier");
  });
}

export async function saveVatRateAction(input: { id?: number; name: string; ratePct: string; mydataCategory: number | null; active: boolean }) {
  return run(async () => {
    await requireRole("admin");
    if (!input.name.trim()) throw new Error("Απαιτείται όνομα συντελεστή");
    const rate = Number(input.ratePct.replace(",", "."));
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Μη έγκυρος συντελεστής (0–100)");
    await upsertVatRate({ id: input.id, name: input.name.trim(), ratePct: String(rate), mydataCategory: input.mydataCategory, active: input.active });
    revalidatePath("/admin/settings");
    revalidatePath("/admin/menu");
  });
}
