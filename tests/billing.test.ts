import { describe, expect, it } from "vitest";
import { computeTotals } from "@/server/services/billing";

const item = (unit: number, qty: number, vat: number, mods: number[] = [], status = "sent") => ({
  unitPriceCents: unit,
  qty,
  vatRatePct: vat,
  status,
  modifiers: mods.map((priceDeltaCents) => ({ priceDeltaCents })),
});

describe("computeTotals", () => {
  it("sums lines with modifiers and ignores voided", () => {
    const t = computeTotals([item(1200, 2, 13, [300]), item(500, 1, 24), item(999, 1, 13, [], "voided")], 0, []);
    expect(t.subtotalCents).toBe(3000 + 500);
    expect(t.totalCents).toBe(3500);
    expect(t.dueCents).toBe(3500);
  });

  it("allocates discount proportionally and vat breakdown sums to total", () => {
    const t = computeTotals([item(1000, 1, 13), item(1000, 1, 24)], 300, [{ amountCents: 700 }]);
    expect(t.discountCents).toBe(300);
    expect(t.totalCents).toBe(1700);
    const gross = t.vat.reduce((n, v) => n + v.grossCents, 0);
    expect(gross).toBe(1700);
    for (const v of t.vat) expect(v.netCents + v.vatCents).toBe(v.grossCents);
    expect(t.vat.find((v) => v.ratePct === 13)!.grossCents).toBe(850);
    expect(t.vat.find((v) => v.ratePct === 24)!.grossCents).toBe(850);
    expect(t.paidCents).toBe(700);
    expect(t.dueCents).toBe(1000);
  });

  it("caps discount at subtotal", () => {
    const t = computeTotals([item(500, 1, 13)], 5000, []);
    expect(t.discountCents).toBe(500);
    expect(t.totalCents).toBe(0);
  });

  it("computes included VAT correctly", () => {
    const t = computeTotals([item(11300, 1, 13)], 0, []);
    expect(t.vat[0].netCents).toBe(10000);
    expect(t.vat[0].vatCents).toBe(1300);
  });
});
