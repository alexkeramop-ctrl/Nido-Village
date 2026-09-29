import { beforeAll, describe, expect, it } from "vitest";
import { seeded, employeeByName, ingredientByName, productByName } from "./helpers";
import { receiveGoods, recordWaste, stockCount, listIngredients, consumptionReport, getRecipe, setRecipe, recipeCosts, listMovements } from "@/server/services/inventory";
import { num } from "@/server/money";

let admin: { id: number };
beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});

describe("inventory", () => {
  it("receives goods with moving average cost", async () => {
    const pork = await ingredientByName("Μπιφτέκι μοσχαρίσιο 150g"); // 60 pcs @ 1.60
    const r = await receiveGoods({ docNumber: "ΤΔΑ-100", lines: [{ ingredientId: pork.id, qty: 40, unitCost: 1.9 }] }, admin.id);
    expect(r.totalCents).toBe(7600);
    const after = await ingredientByName("Μπιφτέκι μοσχαρίσιο 150g");
    expect(num(after.stockQty)).toBe(100);
    expect(num(after.costPerUnit)).toBeCloseTo((60 * 1.6 + 40 * 1.9) / 100, 6);
  });

  it("records waste and counts", async () => {
    const tomato = await ingredientByName("Ντομάτα");
    const before = num(tomato.stockQty);
    await recordWaste(tomato.id, 500, "Χαλασμένες", admin.id);
    expect(num((await ingredientByName("Ντομάτα")).stockQty)).toBe(before - 500);
    const res = await stockCount([{ ingredientId: tomato.id, countedQty: before - 800 }], admin.id, "Βραδινή απογραφή");
    expect(res[0].delta).toBe(-300);
    expect(num((await ingredientByName("Ντομάτα")).stockQty)).toBe(before - 800);
    const moves = await listMovements({ ingredientId: tomato.id });
    expect(moves.map((m) => m.kind)).toEqual(["count", "waste", "manual"]);
  });

  it("flags low stock", async () => {
    const olives = await ingredientByName("Bacon"); // 2000 min 400
    await recordWaste(olives.id, 1700, "test", admin.id);
    const list = await listIngredients();
    expect(list.find((i) => i.id === olives.id)?.low).toBe(true);
    expect(list.find((i) => i.name === "Ντομάτα")?.low).toBe(false);
  });

  it("edits a recipe and computes product cost", async () => {
    const p = await productByName("Cappuccino");
    const before = await getRecipe(p.id);
    expect(before.length).toBe(2);
    const yog = await ingredientByName("Γάλα");
    await setRecipe({ productId: p.id }, [{ ingredientId: yog.id, qty: 200 }]);
    const after = await getRecipe(p.id);
    expect(after).toHaveLength(1);
    const costs = await recipeCosts();
    expect(costs.get(p.id)).toBe(Math.round(200 * 0.0013 * 100));
  });

  it("consumption report aggregates movements", async () => {
    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);
    const rep = await consumptionReport(from, to);
    const tomato = rep.find((r) => r.ingredient.name === "Ντομάτα")!;
    expect(tomato.waste).toBe(500);
    expect(tomato.countDiff).toBeCloseTo(-300, 3); // μόνο η απογραφή, όχι το αρχικό απόθεμα
  });
});
