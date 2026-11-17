import { describe, expect, it } from "vitest";
import { addLine, cartTotal, repriceCart, type PricedProduct, type UiLine } from "@/components/ops/cart";

const water: PricedProduct = { id: 1, name: "Νερό 1L", priceCents: 100, modifierGroups: [] };
const burger: PricedProduct = {
  id: 2,
  name: "Classic Burger",
  priceCents: 850,
  modifierGroups: [{ modifiers: [{ id: 10, name: "Extra τυρί", priceDeltaCents: 100 }, { id: 11, name: "Bacon", priceDeltaCents: 150 }] }],
};

function cart(): UiLine[] {
  let c: UiLine[] = [];
  c = addLine(c, { productId: 1, name: "Νερό 1L", unitPriceCents: 100, qty: 3, course: 1, notes: "", modifiers: [] });
  c = addLine(c, { productId: 2, name: "Classic Burger", unitPriceCents: 850, qty: 2, course: 1, notes: "καλοψημένο", modifiers: [{ id: 10, name: "Extra τυρί", priceDeltaCents: 100 }] });
  return c;
}

describe("καλάθι ταμείου: ξανατιμολόγηση από φρέσκο κατάλογο", () => {
  it("ίδιος κατάλογος: τίποτα δεν αλλάζει (ίδιες γραμμές, καμία ειδοποίηση)", () => {
    const c = cart();
    const r = repriceCart(c, [water, burger]);
    expect(r.repriced).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe(c[0]);
    expect(r.lines[1]).toBe(c[1]);
    expect(cartTotal(r.lines)).toBe(3 * 100 + 2 * 950);
  });

  it("αλλαγή τιμής είδους και επιλογής: το καλάθι παίρνει τις τρέχουσες τιμές και λέει τι άλλαξε", () => {
    const c = cart();
    const r = repriceCart(c, [
      { ...water, priceCents: 150 },
      { ...burger, modifierGroups: [{ modifiers: [{ id: 10, name: "Extra τυρί", priceDeltaCents: 120 }] }] },
    ]);
    expect(r.repriced).toEqual(["Νερό 1L", "Classic Burger"]);
    expect(r.removed).toEqual([]);
    expect(r.lines.map((l) => [l.key, l.qty, l.unitPriceCents, l.notes])).toEqual([
      [c[0].key, 3, 150, ""],
      [c[1].key, 2, 850, "καλοψημένο"],
    ]);
    expect(r.lines[1].modifiers).toEqual([{ id: 10, name: "Extra τυρί", priceDeltaCents: 120 }]);
    // 3 × 1,50 + 2 × (8,50 + 1,20)
    expect(cartTotal(r.lines)).toBe(450 + 1940);
    // Το αρχικό καλάθι δεν πειράζεται (καθαρή συνάρτηση).
    expect(cartTotal(c)).toBe(300 + 1900);
  });

  it("είδος ή επιλογή που δεν πωλείται πια: η γραμμή βγαίνει από το καλάθι", () => {
    const c = cart();
    const noCheese = repriceCart(c, [water, { ...burger, modifierGroups: [{ modifiers: [{ id: 11, name: "Bacon", priceDeltaCents: 150 }] }] }]);
    expect(noCheese.removed).toEqual(["Classic Burger"]);
    expect(noCheese.lines.map((l) => l.productId)).toEqual([1]);
    const noWater = repriceCart(c, [burger]);
    expect(noWater.removed).toEqual(["Νερό 1L"]);
    expect(noWater.repriced).toEqual([]);
    expect(cartTotal(noWater.lines)).toBe(1900);
    expect(repriceCart(c, []).lines).toEqual([]);
  });

  it("μετονομασία χωρίς αλλαγή τιμής: ενημερώνεται το όνομα, χωρίς ειδοποίηση τιμής", () => {
    const r = repriceCart(cart(), [{ ...water, name: "Νερό 1 λίτρο" }, burger]);
    expect(r.repriced).toEqual([]);
    expect(r.lines[0].name).toBe("Νερό 1 λίτρο");
    expect(r.lines[0].unitPriceCents).toBe(100);
  });
});
