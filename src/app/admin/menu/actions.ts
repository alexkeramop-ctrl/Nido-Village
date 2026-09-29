"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { parseEuroToCents } from "@/server/money";
import { deleteCategory, deleteProduct, setProductAvailability, upsertCategory, upsertProduct } from "@/server/services/catalog";

export async function saveCategoryAction(input: { id?: number; name: string; sort: number; color: string; printStationId: number | null; active: boolean }) {
  return run(async () => {
    await requireRole("manager", "admin");
    await upsertCategory(input);
    revalidatePath("/admin/menu");
  });
}

export async function saveProductAction(input: {
  id?: number;
  name: string;
  categoryId: number;
  price: string;
  vatRateId: number;
  printStationId: number | null;
  sku: string | null;
  available: boolean;
  active: boolean;
  sort: number;
  modifierGroupIds: number[];
}) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!input.categoryId) throw new Error("Επίλεξε κατηγορία");
    if (!input.vatRateId) throw new Error("Επίλεξε συντελεστή ΦΠΑ");
    const priceCents = parseEuroToCents(input.price);
    if (priceCents < 0) throw new Error("Η τιμή δεν μπορεί να είναι αρνητική");
    await upsertProduct({
      id: input.id,
      name: input.name,
      categoryId: input.categoryId,
      priceCents,
      vatRateId: input.vatRateId,
      printStationId: input.printStationId,
      sku: input.sku,
      available: input.available,
      active: input.active,
      sort: input.sort,
      modifierGroupIds: input.modifierGroupIds,
    });
    revalidatePath("/admin/menu");
    revalidatePath("/admin/recipes");
  });
}

export async function setAvailabilityAction(id: number, available: boolean) {
  return run(async () => {
    await requireRole("manager", "admin");
    await setProductAvailability(id, available);
    revalidatePath("/admin/menu");
  });
}

/** Διαγραφή κατηγορίας (μόνο αν δεν έχει είδη· αλλιώς η υπηρεσία ρίχνει σφάλμα). */
export async function deleteCategoryAction(id: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!Number.isInteger(id) || id <= 0) throw new Error("Μη έγκυρη κατηγορία");
    await deleteCategory(id);
    revalidatePath("/admin/menu");
    revalidatePath("/pda");
  });
}

/** Διαγραφή είδους: πλήρης αν δεν έχει πωλήσεις, αλλιώς απενεργοποίηση. */
export async function deleteProductAction(id: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!Number.isInteger(id) || id <= 0) throw new Error("Μη έγκυρο είδος");
    const result = await deleteProduct(id);
    revalidatePath("/admin/menu");
    revalidatePath("/admin/recipes");
    revalidatePath("/pda");
    return result;
  });
}
