import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";

export async function listVatRates() {
  const db = await getDb();
  return db.query.vatRates.findMany({ orderBy: [asc(schema.vatRates.id)] });
}

export async function upsertVatRate(input: { id?: number; name: string; ratePct: string; mydataCategory?: number | null; active?: boolean }) {
  const db = await getDb();
  const values = {
    name: input.name,
    ratePct: Number(input.ratePct.replace(",", ".")).toFixed(2),
    mydataCategory: input.mydataCategory ?? null,
    active: input.active ?? true,
  };
  const [row] = input.id
    ? await db.update(schema.vatRates).set(values).where(eq(schema.vatRates.id, input.id)).returning()
    : await db.insert(schema.vatRates).values(values).returning();
  emit({ type: "catalog.changed" });
  return row;
}

export async function listCategories(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.categories.findMany({
    orderBy: [asc(schema.categories.sort), asc(schema.categories.id)],
    with: { printStation: true },
  });
  return includeInactive ? rows : rows.filter((c) => c.active);
}

export async function upsertCategory(input: {
  id?: number;
  name: string;
  sort?: number;
  color?: string;
  printStationId?: number | null;
  active?: boolean;
}) {
  const db = await getDb();
  const values = {
    name: input.name.trim(),
    sort: input.sort ?? 0,
    color: input.color ?? "#0f766e",
    printStationId: input.printStationId ?? null,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα κατηγορίας");
  const [row] = input.id
    ? await db.update(schema.categories).set(values).where(eq(schema.categories.id, input.id)).returning()
    : await db.insert(schema.categories).values(values).returning();
  emit({ type: "catalog.changed" });
  return row;
}

export async function listProducts(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.products.findMany({
    orderBy: [asc(schema.products.sort), asc(schema.products.name)],
    with: {
      category: true,
      vatRate: true,
      printStation: true,
      modifierGroups: { with: { group: true } },
    },
  });
  return includeInactive ? rows : rows.filter((p) => p.active);
}

export async function getProduct(id: number) {
  const db = await getDb();
  return db.query.products.findFirst({
    where: eq(schema.products.id, id),
    with: { category: true, vatRate: true, modifierGroups: { with: { group: { with: { modifiers: true } } } } },
  });
}

export async function upsertProduct(input: {
  id?: number;
  categoryId: number;
  name: string;
  priceCents: number;
  vatRateId: number;
  printStationId?: number | null;
  sku?: string | null;
  available?: boolean;
  sort?: number;
  active?: boolean;
  modifierGroupIds?: number[];
}) {
  const db = await getDb();
  const values = {
    categoryId: input.categoryId,
    name: input.name.trim(),
    priceCents: Math.max(0, Math.round(input.priceCents)),
    vatRateId: input.vatRateId,
    printStationId: input.printStationId ?? null,
    sku: input.sku ?? null,
    available: input.available ?? true,
    sort: input.sort ?? 0,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα είδους");
  const row = await db.transaction(async (tx) => {
    const [p] = input.id
      ? await tx.update(schema.products).set(values).where(eq(schema.products.id, input.id)).returning()
      : await tx.insert(schema.products).values(values).returning();
    if (input.modifierGroupIds) {
      await tx.delete(schema.productModifierGroups).where(eq(schema.productModifierGroups.productId, p.id));
      if (input.modifierGroupIds.length) {
        await tx
          .insert(schema.productModifierGroups)
          .values(input.modifierGroupIds.map((groupId, i) => ({ productId: p.id, groupId, sort: i })));
      }
    }
    return p;
  });
  emit({ type: "catalog.changed" });
  return row;
}

export async function setProductAvailability(id: number, available: boolean) {
  const db = await getDb();
  await db.update(schema.products).set({ available }).where(eq(schema.products.id, id));
  emit({ type: "catalog.changed" });
}

export async function listModifierGroups(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.modifierGroups.findMany({
    orderBy: [asc(schema.modifierGroups.name)],
    with: { modifiers: { orderBy: [asc(schema.modifiers.sort), asc(schema.modifiers.id)] } },
  });
  return includeInactive ? rows : rows.filter((g) => g.active);
}

export async function upsertModifierGroup(input: { id?: number; name: string; minSelect?: number; maxSelect?: number; active?: boolean }) {
  const db = await getDb();
  const values = {
    name: input.name.trim(),
    minSelect: input.minSelect ?? 0,
    maxSelect: input.maxSelect ?? 1,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα ομάδας");
  const [row] = input.id
    ? await db.update(schema.modifierGroups).set(values).where(eq(schema.modifierGroups.id, input.id)).returning()
    : await db.insert(schema.modifierGroups).values(values).returning();
  emit({ type: "catalog.changed" });
  return row;
}

export async function upsertModifier(input: { id?: number; groupId: number; name: string; priceDeltaCents?: number; sort?: number; active?: boolean }) {
  const db = await getDb();
  const values = {
    groupId: input.groupId,
    name: input.name.trim(),
    priceDeltaCents: Math.round(input.priceDeltaCents ?? 0),
    sort: input.sort ?? 0,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα επιλογής");
  const [row] = input.id
    ? await db.update(schema.modifiers).set(values).where(eq(schema.modifiers.id, input.id)).returning()
    : await db.insert(schema.modifiers).values(values).returning();
  emit({ type: "catalog.changed" });
  return row;
}

/** Το μενού όπως το βλέπει το PDA: μόνο ενεργά, με ομάδες επιλογών. */
export async function getMenu() {
  const db = await getDb();
  const cats = await db.query.categories.findMany({
    where: eq(schema.categories.active, true),
    orderBy: [asc(schema.categories.sort), asc(schema.categories.id)],
    with: {
      products: {
        where: eq(schema.products.active, true),
        orderBy: [asc(schema.products.sort), asc(schema.products.name)],
        with: {
          vatRate: true,
          modifierGroups: {
            orderBy: [asc(schema.productModifierGroups.sort)],
            with: { group: { with: { modifiers: { orderBy: [asc(schema.modifiers.sort)] } } } },
          },
        },
      },
    },
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    products: c.products.map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: p.priceCents,
      available: p.available,
      vatRatePct: Number(p.vatRate.ratePct),
      modifierGroups: p.modifierGroups
        .filter((pg) => pg.group.active)
        .map((pg) => ({
          id: pg.group.id,
          name: pg.group.name,
          minSelect: pg.group.minSelect,
          maxSelect: pg.group.maxSelect,
          modifiers: pg.group.modifiers
            .filter((m) => m.active)
            .map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents })),
        })),
    })),
  }));
}

export type Menu = Awaited<ReturnType<typeof getMenu>>;

/** Φορτώνει προϊόντα με κατηγορία και ΦΠΑ για χρήση από την παραγγελιοληψία. */
export async function loadProductsForOrder(ids: number[]) {
  const db = await getDb();
  if (!ids.length) return [];
  return db.query.products.findMany({
    where: and(inArray(schema.products.id, ids), eq(schema.products.active, true)),
    with: { category: true, vatRate: true },
  });
}
