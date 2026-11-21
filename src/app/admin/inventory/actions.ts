"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { parseEuroToCents } from "@/server/money";
import { adjustStock, deleteIngredient, deleteSupplier, receiveGoods, recordWaste, stockCount, upsertIngredient, upsertSupplier } from "@/server/services/inventory";
import type { StockUnit } from "@/db/schema";
import { receiveInvoice } from "@/server/services/invoice-receipt";

const UNITS: StockUnit[] = ["g", "kg", "ml", "l", "pcs"];

function revalidateStock() {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
}

export async function saveIngredientAction(input: {
  id?: number;
  name: string;
  unit: string;
  minQty: number;
  costPerUnit: number;
  supplierId: number | null;
  active: boolean;
  packSize: number | null;
  packName: string | null;
  portionQty: number | null;
  portionName: string | null;
}) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!UNITS.includes(input.unit as StockUnit)) throw new Error("Μη έγκυρη μονάδα μέτρησης");
    if (input.minQty < 0 || input.costPerUnit < 0) throw new Error("Οι τιμές δεν μπορούν να είναι αρνητικές");
    if ((input.packSize ?? 0) < 0 || (input.portionQty ?? 0) < 0) throw new Error("Η συσκευασία και η μερίδα δεν μπορούν να είναι αρνητικές");
    await upsertIngredient({ ...input, unit: input.unit as StockUnit });
    revalidateStock();
  });
}

/** Διαγραφή πρώτης ύλης: πλήρης αν δεν έχει ιστορικό, αλλιώς απενεργοποίηση. */
export async function deleteIngredientAction(id: number) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    if (!Number.isInteger(id) || id <= 0) throw new Error("Μη έγκυρη πρώτη ύλη");
    const result = await deleteIngredient(id, me.id);
    revalidateStock();
    return result;
  });
}

/** Διαγραφή προμηθευτή: πλήρης αν δεν έχει παραλαβές, αλλιώς απενεργοποίηση. */
export async function deleteSupplierAction(id: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!Number.isInteger(id) || id <= 0) throw new Error("Μη έγκυρος προμηθευτής");
    const result = await deleteSupplier(id);
    revalidatePath("/admin/inventory");
    return result;
  });
}

export async function recordWasteAction(input: { ingredientId: number; qty: number; note: string }) {
  return run(async () => {
    const user = await requireRole("manager", "admin");
    if (!(input.qty > 0)) throw new Error("Δώσε ποσότητα μεγαλύτερη από 0");
    await recordWaste(input.ingredientId, input.qty, input.note, user.id);
    revalidateStock();
  });
}

export async function adjustStockAction(input: { ingredientId: number; delta: number; note: string }) {
  return run(async () => {
    const user = await requireRole("manager", "admin");
    if (!input.delta) throw new Error("Δώσε διαφορά διαφορετική από 0");
    await adjustStock(input.ingredientId, input.delta, input.note, user.id);
    revalidateStock();
  });
}

export async function receiveGoodsAction(input: {
  supplierId: number | null;
  docNumber: string;
  docDate: string;
  notes: string;
  lines: { ingredientId: number; qty: number; unitCost: string }[];
}) {
  return run(async () => {
    const user = await requireRole("manager", "admin");
    const lines = input.lines
      .filter((l) => l.ingredientId && l.qty > 0)
      .map((l) => ({ ingredientId: l.ingredientId, qty: l.qty, unitCost: parseEuroToCents(l.unitCost || "0") / 100 }));
    if (!lines.length) throw new Error("Πρόσθεσε τουλάχιστον μία γραμμή με ποσότητα");
    if (lines.some((l) => l.unitCost < 0)) throw new Error("Το κόστος δεν μπορεί να είναι αρνητικό");
    const docDate = input.docDate ? new Date(input.docDate + "T12:00:00") : new Date();
    if (Number.isNaN(docDate.getTime())) throw new Error("Μη έγκυρη ημερομηνία");
    const r = await receiveGoods({ supplierId: input.supplierId, docNumber: input.docNumber, docDate, notes: input.notes, lines }, user.id);
    revalidateStock();
    return { id: r.id, totalCents: r.totalCents };
  });
}

/** Παραλαβή από τιμολόγιο που διαβάστηκε και ελέγχθηκε από τον χρήστη. */
export async function receiveInvoiceAction(input: {
  supplierId: number | null;
  newSupplier: { name: string; vat: string | null } | null;
  docNumber: string;
  docDate: string;
  notes: string;
  allowDuplicate: boolean;
  lines: { itemKey: string; ingredientId: number; quantity: number; unitPriceNet: number; factor: number; remember: boolean }[];
}) {
  return run(async () => {
    const user = await requireRole("manager", "admin");
    const docDate = input.docDate ? new Date(input.docDate + "T12:00:00") : new Date();
    if (Number.isNaN(docDate.getTime())) throw new Error("Μη έγκυρη ημερομηνία");
    const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 200).map((l) => ({
      itemKey: String(l?.itemKey ?? "").slice(0, 200),
      ingredientId: Number(l?.ingredientId) || 0,
      quantity: Number(l?.quantity),
      unitPriceNet: Number(l?.unitPriceNet),
      factor: Number(l?.factor),
      remember: Boolean(l?.remember),
    }));
    const r = await receiveInvoice(
      {
        supplierId: Number(input.supplierId) > 0 ? Number(input.supplierId) : null,
        newSupplier: input.newSupplier?.name ? { name: String(input.newSupplier.name), vat: input.newSupplier.vat ? String(input.newSupplier.vat) : null } : null,
        docNumber: String(input.docNumber ?? ""),
        docDate,
        notes: String(input.notes ?? "").slice(0, 200),
        allowDuplicate: Boolean(input.allowDuplicate),
        lines,
      },
      user.id,
    );
    revalidateStock();
    revalidatePath("/admin/costing");
    return r;
  });
}

export async function stockCountAction(lines: { ingredientId: number; countedQty: number }[], note: string) {
  return run(async () => {
    const user = await requireRole("manager", "admin");
    const clean = lines.filter((l) => Number.isFinite(l.countedQty) && l.countedQty >= 0);
    if (!clean.length) throw new Error("Δεν υπάρχουν αλλαγές για καταχώρηση");
    const results = await stockCount(clean, user.id, note);
    revalidateStock();
    return results;
  });
}

export async function saveSupplierAction(input: { id?: number; name: string; vatNumber: string | null; phone: string | null; email: string | null; notes: string | null; active: boolean }) {
  return run(async () => {
    await requireRole("manager", "admin");
    await upsertSupplier(input);
    revalidatePath("/admin/inventory");
  });
}
