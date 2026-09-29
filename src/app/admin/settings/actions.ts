"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { upsertVatRate } from "@/server/services/catalog";
import { saveSettings } from "@/server/services/settings";

export async function saveSettingsAction(input: { venueName: string; vatNumber: string; taxOffice: string; address: string; phone: string; courses: number }) {
  return run(async () => {
    await requireRole("admin");
    if (!input.venueName.trim()) throw new Error("Απαιτείται επωνυμία");
    const courses = Math.min(5, Math.max(1, Math.round(input.courses)));
    await saveSettings({
      venueName: input.venueName.trim(),
      vatNumber: input.vatNumber.trim(),
      taxOffice: input.taxOffice.trim(),
      address: input.address.trim(),
      phone: input.phone.trim(),
      courses,
    });
    revalidatePath("/admin/settings");
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
