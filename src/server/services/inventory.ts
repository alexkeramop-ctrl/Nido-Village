/**
 * Αποθήκη: πρώτες ύλες, συνταγές, παραλαβές, φύρα, απογραφές, κινήσεις.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type DbLike } from "@/server/audit";
import { emit } from "@/server/events";
import { num, qty3, qty4 } from "@/server/money";
import type { MovementKind, StockUnit } from "@/db/schema";

export const UNIT_LABEL: Record<StockUnit, string> = { g: "γρ.", kg: "κιλά", ml: "ml", l: "λίτρα", pcs: "τεμ." };
export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  purchase: "Παραλαβή",
  sale: "Πώληση",
  void_reversal: "Ακύρωση",
  waste: "Φύρα",
  count: "Απογραφή",
  manual: "Χειροκίνητη",
};

export async function listSuppliers(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.suppliers.findMany({ orderBy: [asc(schema.suppliers.name)] });
  return includeInactive ? rows : rows.filter((s) => s.active);
}

export async function upsertSupplier(input: { id?: number; name: string; vatNumber?: string | null; phone?: string | null; email?: string | null; notes?: string | null; active?: boolean }) {
  const db = await getDb();
  const values = {
    name: input.name.trim(),
    vatNumber: input.vatNumber || null,
    phone: input.phone || null,
    email: input.email || null,
    notes: input.notes || null,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα προμηθευτή");
  const [row] = input.id
    ? await db.update(schema.suppliers).set(values).where(eq(schema.suppliers.id, input.id)).returning()
    : await db.insert(schema.suppliers).values(values).returning();
  return row;
}

export async function listIngredients(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.ingredients.findMany({ orderBy: [asc(schema.ingredients.name)], with: { supplier: true } });
  return rows
    .filter((i) => includeInactive || i.active)
    .map((i) => ({
      ...i,
      stock: num(i.stockQty),
      min: num(i.minQty),
      cost: num(i.costPerUnit),
      low: num(i.minQty) > 0 && num(i.stockQty) <= num(i.minQty),
      stockValueCents: Math.round(num(i.stockQty) * num(i.costPerUnit) * 100),
    }));
}

export async function upsertIngredient(input: {
  id?: number;
  name: string;
  unit: StockUnit;
  minQty?: number;
  costPerUnit?: number;
  supplierId?: number | null;
  active?: boolean;
}) {
  const db = await getDb();
  const values = {
    name: input.name.trim(),
    unit: input.unit,
    minQty: qty3(input.minQty ?? 0),
    costPerUnit: qty4(input.costPerUnit ?? 0),
    supplierId: input.supplierId ?? null,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα πρώτης ύλης");
  const [row] = input.id
    ? await db.update(schema.ingredients).set(values).where(eq(schema.ingredients.id, input.id)).returning()
    : await db.insert(schema.ingredients).values(values).returning();
  emit({ type: "stock.changed" });
  return row;
}

/* ------------------------------- Συνταγές ------------------------------- */

export async function getRecipe(productId: number) {
  const db = await getDb();
  const lines = await db.query.recipeLines.findMany({
    where: eq(schema.recipeLines.productId, productId),
    with: { ingredient: true },
  });
  return lines.map((l) => ({ id: l.id, ingredientId: l.ingredientId, ingredient: l.ingredient, qty: num(l.qty) }));
}

export async function setRecipe(target: { productId: number } | { modifierId: number }, lines: { ingredientId: number; qty: number }[]) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    if ("productId" in target) {
      await tx.delete(schema.recipeLines).where(eq(schema.recipeLines.productId, target.productId));
      const clean = lines.filter((l) => l.qty > 0);
      if (clean.length)
        await tx.insert(schema.recipeLines).values(clean.map((l) => ({ productId: target.productId, ingredientId: l.ingredientId, qty: qty3(l.qty) })));
    } else {
      await tx.delete(schema.recipeLines).where(eq(schema.recipeLines.modifierId, target.modifierId));
      const clean = lines.filter((l) => l.qty > 0);
      if (clean.length)
        await tx.insert(schema.recipeLines).values(clean.map((l) => ({ modifierId: target.modifierId, ingredientId: l.ingredientId, qty: qty3(l.qty) })));
    }
  });
  emit({ type: "stock.changed" });
}

/** Κόστος συνταγής ενός προϊόντος σε λεπτά (βάσει τρέχοντος κόστους πρώτων υλών). */
export async function recipeCosts() {
  const db = await getDb();
  const lines = await db.query.recipeLines.findMany({ where: isNotNull(schema.recipeLines.productId), with: { ingredient: true } });
  const cost = new Map<number, number>();
  for (const l of lines) {
    const c = num(l.qty) * num(l.ingredient.costPerUnit) * 100;
    cost.set(l.productId!, (cost.get(l.productId!) ?? 0) + c);
  }
  return new Map([...cost.entries()].map(([k, v]) => [k, Math.round(v)]));
}

/**
 * Εφαρμόζει τις κινήσεις αποθήκης μιας πώλησης (ή αντιλογισμού) βάσει συνταγής
 * προϊόντος + συνταγών επιλογών. Καλείται μέσα σε transaction.
 */
export async function applyRecipeMovements(
  db: DbLike,
  input: {
    productId: number;
    modifierIds: number[];
    qty: number;
    kind: "sale" | "void_reversal";
    refType: string;
    refId: number;
    employeeId: number;
  },
) {
  const conds = [eq(schema.recipeLines.productId, input.productId)];
  if (input.modifierIds.length) conds.push(inArray(schema.recipeLines.modifierId, input.modifierIds));
  const lines = await db.query.recipeLines.findMany({ where: conds.length > 1 ? or(...conds) : conds[0] });
  if (!lines.length) return;
  const sign = input.kind === "sale" ? -1 : 1;
  const totals = new Map<number, number>();
  for (const l of lines) totals.set(l.ingredientId, (totals.get(l.ingredientId) ?? 0) + num(l.qty) * input.qty * sign);
  for (const [ingredientId, delta] of totals) {
    await db.insert(schema.stockMovements).values({
      ingredientId,
      kind: input.kind,
      qtyDelta: qty3(delta),
      refType: input.refType,
      refId: input.refId,
      employeeId: input.employeeId,
    });
    await db
      .update(schema.ingredients)
      .set({ stockQty: sql`${schema.ingredients.stockQty} + ${qty3(delta)}::numeric` })
      .where(eq(schema.ingredients.id, ingredientId));
  }
}

/* -------------------------- Παραλαβές / φύρα / απογραφή -------------------------- */

export async function receiveGoods(
  input: { supplierId?: number | null; docNumber?: string | null; docDate?: Date; notes?: string | null; lines: { ingredientId: number; qty: number; unitCost: number }[] },
  employeeId: number,
) {
  const db = await getDb();
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new Error("Η παραλαβή δεν έχει γραμμές");
  const totalCents = Math.round(lines.reduce((n, l) => n + l.qty * l.unitCost * 100, 0));
  const receipt = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.goodsReceipts)
      .values({
        supplierId: input.supplierId ?? null,
        docNumber: input.docNumber || null,
        docDate: input.docDate ?? new Date(),
        totalCents,
        employeeId,
        notes: input.notes || null,
      })
      .returning();
    for (const l of lines) {
      await tx.insert(schema.goodsReceiptLines).values({ receiptId: r.id, ingredientId: l.ingredientId, qty: qty3(l.qty), unitCost: qty4(l.unitCost) });
      const ing = await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.id, l.ingredientId) });
      if (!ing) throw new Error(`Άγνωστη πρώτη ύλη ${l.ingredientId}`);
      const oldQty = Math.max(0, num(ing.stockQty));
      const oldCost = num(ing.costPerUnit);
      // Κινούμενος μέσος όρος κόστους.
      const newCost = oldQty > 0 && oldCost > 0 ? (oldQty * oldCost + l.qty * l.unitCost) / (oldQty + l.qty) : l.unitCost;
      await tx.insert(schema.stockMovements).values({
        ingredientId: l.ingredientId,
        kind: "purchase",
        qtyDelta: qty3(l.qty),
        unitCost: qty4(l.unitCost),
        refType: "goods_receipt",
        refId: r.id,
        employeeId,
      });
      await tx
        .update(schema.ingredients)
        .set({ stockQty: sql`${schema.ingredients.stockQty} + ${qty3(l.qty)}::numeric`, costPerUnit: qty4(newCost) })
        .where(eq(schema.ingredients.id, l.ingredientId));
    }
    await audit(tx, employeeId, "goods_receipt", "goods_receipt", r.id, { totalCents, lines: lines.length });
    return r;
  });
  emit({ type: "stock.changed" });
  return receipt;
}

export async function recordWaste(ingredientId: number, qty: number, note: string, employeeId: number) {
  const db = await getDb();
  if (qty <= 0) throw new Error("Μη έγκυρη ποσότητα");
  await db.transaction(async (tx) => {
    await tx.insert(schema.stockMovements).values({ ingredientId, kind: "waste", qtyDelta: qty3(-qty), note: note || null, employeeId });
    await tx
      .update(schema.ingredients)
      .set({ stockQty: sql`${schema.ingredients.stockQty} - ${qty3(qty)}::numeric` })
      .where(eq(schema.ingredients.id, ingredientId));
    await audit(tx, employeeId, "waste", "ingredient", ingredientId, { qty, note });
  });
  emit({ type: "stock.changed" });
}

export async function adjustStock(ingredientId: number, delta: number, note: string, employeeId: number) {
  const db = await getDb();
  if (!delta) return;
  await db.transaction(async (tx) => {
    await tx.insert(schema.stockMovements).values({ ingredientId, kind: "manual", qtyDelta: qty3(delta), note: note || null, employeeId });
    await tx
      .update(schema.ingredients)
      .set({ stockQty: sql`${schema.ingredients.stockQty} + ${qty3(delta)}::numeric` })
      .where(eq(schema.ingredients.id, ingredientId));
    await audit(tx, employeeId, "stock_adjust", "ingredient", ingredientId, { delta, note });
  });
  emit({ type: "stock.changed" });
}

/** Απογραφή: ορίζει το πραγματικό απόθεμα και καταγράφει τη διαφορά. */
export async function stockCount(lines: { ingredientId: number; countedQty: number }[], employeeId: number, note?: string) {
  const db = await getDb();
  const results: { ingredientId: number; before: number; after: number; delta: number }[] = [];
  await db.transaction(async (tx) => {
    for (const l of lines) {
      const ing = await tx.query.ingredients.findFirst({ where: eq(schema.ingredients.id, l.ingredientId) });
      if (!ing) continue;
      const before = num(ing.stockQty);
      const delta = Math.round((l.countedQty - before) * 1000) / 1000;
      results.push({ ingredientId: l.ingredientId, before, after: l.countedQty, delta });
      if (delta === 0) continue;
      await tx.insert(schema.stockMovements).values({ ingredientId: l.ingredientId, kind: "count", qtyDelta: qty3(delta), note: note || null, employeeId });
      await tx.update(schema.ingredients).set({ stockQty: qty3(l.countedQty) }).where(eq(schema.ingredients.id, l.ingredientId));
    }
    await audit(tx, employeeId, "stock_count", "ingredient", null, { lines: results });
  });
  emit({ type: "stock.changed" });
  return results;
}

export async function listMovements(opts: { ingredientId?: number; limit?: number; from?: Date; to?: Date } = {}) {
  const db = await getDb();
  const conds = [];
  if (opts.ingredientId) conds.push(eq(schema.stockMovements.ingredientId, opts.ingredientId));
  if (opts.from) conds.push(gte(schema.stockMovements.createdAt, opts.from));
  if (opts.to) conds.push(lte(schema.stockMovements.createdAt, opts.to));
  return db.query.stockMovements.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(schema.stockMovements.id)],
    limit: opts.limit ?? 200,
    with: { ingredient: true },
  });
}

export async function listGoodsReceipts(limit = 50) {
  const db = await getDb();
  return db.query.goodsReceipts.findMany({
    orderBy: [desc(schema.goodsReceipts.id)],
    limit,
    with: { supplier: true, lines: { with: { ingredient: true } } },
  });
}

/** Ανάλυση κατανάλωσης ανά πρώτη ύλη σε διάστημα: πωλήσεις, φύρα, απογραφικές διαφορές. */
export async function consumptionReport(from: Date, to: Date) {
  const db = await getDb();
  const rows = await db
    .select({
      ingredientId: schema.stockMovements.ingredientId,
      kind: schema.stockMovements.kind,
      total: sql<string>`sum(${schema.stockMovements.qtyDelta})`,
    })
    .from(schema.stockMovements)
    .where(and(gte(schema.stockMovements.createdAt, from), lte(schema.stockMovements.createdAt, to)))
    .groupBy(schema.stockMovements.ingredientId, schema.stockMovements.kind);
  const ings = await listIngredients(true);
  const byId = new Map(ings.map((i) => [i.id, i]));
  const out = new Map<number, { ingredient: (typeof ings)[number]; sold: number; waste: number; countDiff: number; purchased: number }>();
  for (const r of rows) {
    const ing = byId.get(r.ingredientId);
    if (!ing) continue;
    const e = out.get(r.ingredientId) ?? { ingredient: ing, sold: 0, waste: 0, countDiff: 0, purchased: 0 };
    const v = num(r.total);
    if (r.kind === "sale" || r.kind === "void_reversal") e.sold += -v;
    else if (r.kind === "waste") e.waste += -v;
    else if (r.kind === "count") e.countDiff += v;
    else if (r.kind === "purchase") e.purchased += v;
    out.set(r.ingredientId, e);
  }
  return [...out.values()].sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, "el"));
}
