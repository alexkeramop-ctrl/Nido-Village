/**
 * Κοστολόγηση (food cost / drink cost): κόστος κάθε προϊόντος του καταλόγου από τη συνταγή του
 * και την τιμή αγοράς των πρώτων υλών.
 *
 * Από πού έρχεται η τιμή αγοράς:
 *  - «Τελευταία τιμή τιμολογίου» (προεπιλογή): η τιμή της πιο πρόσφατης Παραλαβής (Αποθήκη › Παραλαβή),
 *    δηλαδή η γραμμή του τιμολογίου. Αλλάζει αμέσως μόλις περαστεί νέα παραλαβή.
 *  - «Μέσο κόστος αποθήκης»: ο κινούμενος μέσος όρος που κρατά η Αποθήκη.
 *  - Αν δεν υπάρχει παραλαβή, χρησιμοποιείται η τιμή που γράφτηκε με το χέρι στην πρώτη ύλη.
 *
 * Το ποσοστό υπολογίζεται πάνω στην ΚΑΘΑΡΗ τιμή πώλησης (χωρίς ΦΠΑ). Οι τιμές αγοράς θεωρούνται χωρίς ΦΠΑ.
 */
import { desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { num } from "@/server/money";
import type { StockUnit } from "@/db/schema";
import { getSettings } from "./settings";
import { addDays, salesByProduct, todayAthens } from "./reports";

export type CostBasis = "last" | "average";
export type CostKind = "food" | "drink";
export type PriceSource = "receipt" | "average" | "manual" | "none";
export type CostStatus = "ok" | "warn" | "danger" | "norecipe" | "noprice" | "nosaleprice";

/** Πόσες μονάδες πάνω από τον στόχο θεωρούνται «οριακά» πριν γίνουν «ακριβό». */
export const WARN_MARGIN_PCT = 5;
/** Τιμή αγοράς παλαιότερη από τόσες ημέρες σημειώνεται ως παλιά. */
export const STALE_PRICE_DAYS = 60;

export type IngredientPrice = {
  unitCost: number;
  source: PriceSource;
  date: string | null;
  docNumber: string | null;
  supplierName: string | null;
  stale: boolean;
};

/* ------------------------------ Καθαροί υπολογισμοί ------------------------------ */

/** Καθαρή τιμή (χωρίς ΦΠΑ) από τελική τιμή με ΦΠΑ, σε λεπτά. */
export function netFromGross(grossCents: number, vatPct: number): number {
  return Math.round(grossCents / (1 + vatPct / 100));
}

/** Ποια τιμή αγοράς ισχύει για μια πρώτη ύλη, ανάλογα με τη βάση υπολογισμού. */
export function resolvePrice(
  basis: CostBasis,
  ing: { costPerUnit: number },
  last: { unitCost: number; date: string; docNumber: string | null; supplierName: string | null } | undefined,
  today: string,
): IngredientPrice {
  const stale = !!last && last.date < addDays(today, -STALE_PRICE_DAYS);
  if (basis === "last" && last && last.unitCost > 0) {
    return { unitCost: last.unitCost, source: "receipt", date: last.date, docNumber: last.docNumber, supplierName: last.supplierName, stale };
  }
  if (ing.costPerUnit > 0) {
    return {
      unitCost: ing.costPerUnit,
      source: last ? "average" : "manual",
      date: last?.date ?? null,
      docNumber: last?.docNumber ?? null,
      supplierName: last?.supplierName ?? null,
      stale,
    };
  }
  return { unitCost: 0, source: "none", date: null, docNumber: null, supplierName: null, stale: false };
}

export function costStatus(input: { hasRecipe: boolean; missingPrices: number; netCents: number; costPct: number | null; targetPct: number }): CostStatus {
  if (!input.hasRecipe) return "norecipe";
  if (input.missingPrices > 0) return "noprice";
  if (input.netCents <= 0 || input.costPct === null) return "nosaleprice";
  if (input.costPct <= input.targetPct) return "ok";
  if (input.costPct <= input.targetPct + WARN_MARGIN_PCT) return "warn";
  return "danger";
}

/** Τιμή με ΦΠΑ που πιάνει τον στόχο, στρογγυλεμένη προς τα πάνω στα 10 λεπτά. */
export function suggestedGrossCents(costCents: number, targetPct: number, vatPct: number): number | null {
  if (costCents <= 0 || targetPct <= 0) return null;
  const net = costCents / (targetPct / 100);
  return Math.ceil((net * (1 + vatPct / 100)) / 10) * 10;
}

/* ---------------------------------- Δεδομένα ---------------------------------- */

/** Η πιο πρόσφατη τιμή παραλαβής (γραμμή τιμολογίου) ανά πρώτη ύλη. */
export async function lastPurchasePrices() {
  const db = await getDb();
  const rows = await db
    .select({
      ingredientId: schema.goodsReceiptLines.ingredientId,
      unitCost: schema.goodsReceiptLines.unitCost,
      lineId: schema.goodsReceiptLines.id,
      docDate: schema.goodsReceipts.docDate,
      docNumber: schema.goodsReceipts.docNumber,
      supplierName: schema.suppliers.name,
    })
    .from(schema.goodsReceiptLines)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceiptLines.receiptId, schema.goodsReceipts.id))
    .leftJoin(schema.suppliers, eq(schema.goodsReceipts.supplierId, schema.suppliers.id))
    .orderBy(desc(schema.goodsReceipts.docDate), desc(schema.goodsReceiptLines.id));
  const map = new Map<number, { unitCost: number; date: string; docNumber: string | null; supplierName: string | null }>();
  for (const r of rows) {
    if (map.has(r.ingredientId)) continue;
    const d = r.docDate instanceof Date ? r.docDate : new Date(r.docDate);
    map.set(r.ingredientId, { unitCost: num(r.unitCost), date: d.toISOString().slice(0, 10), docNumber: r.docNumber, supplierName: r.supplierName });
  }
  return map;
}

export type CostLine = {
  ingredientId: number;
  name: string;
  unit: StockUnit;
  qty: number;
  price: IngredientPrice;
  /** Κόστος γραμμής σε λεπτά (με δεκαδικά, στρογγυλεύεται μόνο στο σύνολο). */
  cents: number;
};

export type ProductCost = {
  productId: number;
  name: string;
  category: string;
  kind: CostKind;
  priceCents: number;
  vatPct: number;
  netCents: number;
  costCents: number;
  costPct: number | null;
  marginCents: number;
  targetPct: number;
  status: CostStatus;
  suggestedCents: number | null;
  sold30: number;
  lines: CostLine[];
  available: boolean;
};

export type KindSummary = {
  products: number;
  costed: number;
  noRecipe: number;
  missingPrices: number;
  overTarget: number;
  targetPct: number;
  /** Θεωρητικό ποσοστό: σταθμισμένο με τις πωλήσεις 30 ημερών, αλλιώς απλός μέσος όρος. */
  costPct: number | null;
  weighted: boolean;
};

export type IngredientOption = {
  id: number;
  name: string;
  unit: StockUnit;
  packSize: number | null;
  packName: string | null;
  supplierName: string | null;
  price: IngredientPrice;
};

export async function costingOverview(basis: CostBasis = "last") {
  const db = await getDb();
  const today = todayAthens();
  const [settings, products, stations, vatRates, recipeRows, ingredients, last, sales] = await Promise.all([
    getSettings(),
    db.query.products.findMany({ where: eq(schema.products.active, true), with: { category: true } }),
    db.select({ id: schema.printStations.id, kind: schema.printStations.kind }).from(schema.printStations),
    db.select({ id: schema.vatRates.id, ratePct: schema.vatRates.ratePct }).from(schema.vatRates),
    db.query.recipeLines.findMany({ where: isNotNull(schema.recipeLines.productId), with: { ingredient: true } }),
    db.query.ingredients.findMany({ where: eq(schema.ingredients.active, true), with: { supplier: true } }),
    lastPurchasePrices(),
    salesByProduct({ from: addDays(today, -29), to: today }),
  ]);
  const targets: Record<CostKind, number> = { food: settings.foodCostTargetPct, drink: settings.drinkCostTargetPct };
  const stationKind = new Map(stations.map((s) => [s.id, s.kind]));
  const vatPct = new Map(vatRates.map((v) => [v.id, num(v.ratePct)]));
  const soldQty = new Map(sales.map((s) => [s.productId, s.qty]));

  const priceCache = new Map<number, IngredientPrice>();
  const priceOf = (ing: { id: number; costPerUnit: string }) => {
    let p = priceCache.get(ing.id);
    if (!p) {
      p = resolvePrice(basis, { costPerUnit: num(ing.costPerUnit) }, last.get(ing.id), today);
      priceCache.set(ing.id, p);
    }
    return p;
  };

  const linesByProduct = new Map<number, CostLine[]>();
  for (const l of recipeRows) {
    const price = priceOf(l.ingredient);
    const qty = num(l.qty);
    const list = linesByProduct.get(l.productId!) ?? [];
    list.push({ ingredientId: l.ingredientId, name: l.ingredient.name, unit: l.ingredient.unit, qty, price, cents: qty * price.unitCost * 100 });
    linesByProduct.set(l.productId!, list);
  }

  const result: ProductCost[] = products.map((p) => {
    const stationId = p.printStationId ?? p.category.printStationId ?? null;
    const kind: CostKind = stationId !== null && stationKind.get(stationId) === "bar" ? "drink" : "food";
    const vat = vatPct.get(p.vatRateId) ?? 0;
    const netCents = netFromGross(p.priceCents, vat);
    const lines = (linesByProduct.get(p.id) ?? []).sort((a, b) => b.cents - a.cents);
    const costCents = Math.round(lines.reduce((s, l) => s + l.cents, 0));
    const missingPrices = lines.filter((l) => l.price.source === "none").length;
    const costPct = netCents > 0 && lines.length ? Math.round((costCents / netCents) * 1000) / 10 : null;
    const targetPct = targets[kind];
    return {
      productId: p.id,
      name: p.name,
      category: p.category.name,
      kind,
      priceCents: p.priceCents,
      vatPct: vat,
      netCents,
      costCents,
      costPct,
      marginCents: netCents - costCents,
      targetPct,
      status: costStatus({ hasRecipe: lines.length > 0, missingPrices, netCents, costPct, targetPct }),
      suggestedCents: missingPrices === 0 ? suggestedGrossCents(costCents, targetPct, vat) : null,
      sold30: soldQty.get(p.id) ?? 0,
      lines,
      available: p.available,
    };
  });

  const summarize = (kind: CostKind): KindSummary => {
    const rows = result.filter((r) => r.kind === kind);
    const costed = rows.filter((r) => r.status === "ok" || r.status === "warn" || r.status === "danger");
    const sold = costed.filter((r) => r.sold30 > 0);
    let costPct: number | null = null;
    let weighted = false;
    if (sold.length) {
      const cost = sold.reduce((s, r) => s + r.costCents * r.sold30, 0);
      const net = sold.reduce((s, r) => s + r.netCents * r.sold30, 0);
      costPct = net > 0 ? Math.round((cost / net) * 1000) / 10 : null;
      weighted = true;
    } else if (costed.length) {
      costPct = Math.round((costed.reduce((s, r) => s + (r.costPct ?? 0), 0) / costed.length) * 10) / 10;
    }
    return {
      products: rows.length,
      costed: costed.length,
      noRecipe: rows.filter((r) => r.status === "norecipe").length,
      missingPrices: rows.filter((r) => r.status === "noprice").length,
      overTarget: rows.filter((r) => r.status === "warn" || r.status === "danger").length,
      targetPct: targets[kind],
      costPct,
      weighted,
    };
  };

  const ingredientOptions: IngredientOption[] = ingredients
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      packSize: i.packSize ? num(i.packSize) : null,
      packName: i.packName,
      supplierName: i.supplier?.name ?? null,
      price: priceOf(i),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "el"));

  return { basis, today, targets, products: result, summary: { food: summarize("food"), drink: summarize("drink") }, ingredients: ingredientOptions };
}
