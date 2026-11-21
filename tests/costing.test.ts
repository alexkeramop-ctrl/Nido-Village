import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, ingredientByName, productByName } from "./helpers";
import { costStatus, costingOverview, netFromGross, resolvePrice, suggestedGrossCents } from "@/server/services/costing";
import { receiveGoods, setRecipe } from "@/server/services/inventory";
import { num } from "@/server/money";

let admin: { id: number };
beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});

describe("costing: pure calculations", () => {
  it("works on the price without VAT and suggests a rounded price for the target", () => {
    expect(netFromGross(500, 13)).toBe(442);
    expect(netFromGross(500, 24)).toBe(403);
    // Κόστος 1,50 € με στόχο 30% => 5,00 € χωρίς ΦΠΑ => 5,65 € με 13% => 5,70 € (πάνω στα 10 λεπτά).
    expect(suggestedGrossCents(150, 30, 13)).toBe(570);
    expect(suggestedGrossCents(0, 30, 13)).toBeNull();
  });

  it("classifies against the target", () => {
    const base = { hasRecipe: true, missingPrices: 0, netCents: 400, targetPct: 30 };
    expect(costStatus({ ...base, costPct: 29 })).toBe("ok");
    expect(costStatus({ ...base, costPct: 34 })).toBe("warn");
    expect(costStatus({ ...base, costPct: 36 })).toBe("danger");
    expect(costStatus({ ...base, hasRecipe: false, costPct: null })).toBe("norecipe");
    expect(costStatus({ ...base, missingPrices: 1, costPct: 10 })).toBe("noprice");
    expect(costStatus({ ...base, netCents: 0, costPct: null })).toBe("nosaleprice");
  });

  it("uses the last invoice price, or the stock average, or the manual price", () => {
    const last = { unitCost: 0.02, date: "2026-11-01", docNumber: "ΤΔΑ 15", supplierName: "Χ" };
    expect(resolvePrice("last", { costPerUnit: 0.015 }, last, "2026-11-20")).toMatchObject({ unitCost: 0.02, source: "receipt", stale: false });
    expect(resolvePrice("average", { costPerUnit: 0.015 }, last, "2026-11-20")).toMatchObject({ unitCost: 0.015, source: "average" });
    expect(resolvePrice("last", { costPerUnit: 0.015 }, undefined, "2026-11-20")).toMatchObject({ unitCost: 0.015, source: "manual" });
    expect(resolvePrice("last", { costPerUnit: 0 }, undefined, "2026-11-20")).toMatchObject({ unitCost: 0, source: "none" });
    expect(resolvePrice("last", { costPerUnit: 0.015 }, { ...last, date: "2026-08-01" }, "2026-11-20").stale).toBe(true);
  });
});

describe("costing: overview from recipes and goods receipts", () => {
  it("follows a new invoice price immediately and splits food from drinks", async () => {
    const espresso = await productByName("Espresso");
    const coffee = await ingredientByName("Καφές espresso");
    const recipeQty = num((await (await getDb()).query.recipeLines.findFirst({ where: eq(schema.recipeLines.productId, espresso.id) }))!.qty);

    // Νέο τιμολόγιο με ακριβότερο καφέ: η «τελευταία τιμή» αλλάζει αμέσως.
    const newPrice = num(coffee.costPerUnit) * 2 + 0.01;
    await receiveGoods({ docNumber: "ΤΔΑ 999", lines: [{ ingredientId: coffee.id, qty: 1000, unitCost: newPrice }] }, admin.id);

    const last = await costingOverview("last");
    const row = last.products.find((p) => p.productId === espresso.id)!;
    expect(row.kind).toBe("drink");
    expect(row.costCents).toBe(Math.round(recipeQty * newPrice * 100));
    expect(row.lines[0].price).toMatchObject({ source: "receipt", docNumber: "ΤΔΑ 999" });
    expect(row.costPct).toBeCloseTo((row.costCents / row.netCents) * 100, 0);

    // Με μέσο κόστος η τιμή είναι ανάμεσα στην παλιά και τη νέα.
    const avg = await costingOverview("average");
    const avgRow = avg.products.find((p) => p.productId === espresso.id)!;
    expect(avgRow.costCents).toBeLessThanOrEqual(row.costCents);
    expect(avgRow.lines[0].price.source).toBe("average");
  });

  it("flags products without a recipe and counts them per kind", async () => {
    const burger = await productByName("Burger κλασικό").catch(() => null);
    const db = await getDb();
    const anyFood = burger ?? (await db.query.products.findFirst({ where: eq(schema.products.active, true) }))!;
    await setRecipe({ productId: anyFood.id }, []);
    const o = await costingOverview("last");
    const row = o.products.find((p) => p.productId === anyFood.id)!;
    expect(row.status).toBe("norecipe");
    expect(row.costPct).toBeNull();
    const s = o.summary[row.kind];
    expect(s.noRecipe).toBeGreaterThanOrEqual(1);
    expect(s.products).toBe(o.products.filter((p) => p.kind === row.kind).length);
  });
});
