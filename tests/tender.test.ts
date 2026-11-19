import { describe, expect, it } from "vitest";
import { planTender, quickAmounts } from "@/lib/tender";

describe("planTender", () => {
  it("ακριβή μετρητά: μία πληρωμή, χωρίς ρέστα", () => {
    const p = planTender(1250, { cashCents: 1250, cardCents: 0 });
    expect(p.payments).toEqual([{ method: "cash", amountCents: 1250, tenderedCents: 1250, changeCents: 0 }]);
    expect(p.changeCents).toBe(0);
  });

  it("20 € για 12,50 €: ρέστα 7,50 €", () => {
    const p = planTender(1250, { cashCents: 1250, cardCents: 0, tenderedCashCents: 2000 });
    expect(p.changeCents).toBe(750);
    expect(p.payments[0]).toMatchObject({ method: "cash", amountCents: 1250, tenderedCents: 2000, changeCents: 750 });
  });

  it("μόνο κάρτα", () => {
    const p = planTender(990, { cashCents: 0, cardCents: 990 });
    expect(p.payments).toEqual([{ method: "card", amountCents: 990, tenderedCents: 990, changeCents: 0 }]);
    expect(p.changeCents).toBe(0);
  });

  it("μοιρασμένη: 5 € κάρτα + 7,50 € μετρητά με 10 € -> ρέστα 2,50 €", () => {
    const p = planTender(1250, { cashCents: 750, cardCents: 500, tenderedCashCents: 1000 });
    expect(p.payments.map((x) => [x.method, x.amountCents])).toEqual([
      ["card", 500],
      ["cash", 750],
    ]);
    expect(p.changeCents).toBe(250);
    expect(p.payments.reduce((n, x) => n + x.amountCents, 0)).toBe(1250);
  });

  it("απορρίπτει ποσά που δεν αθροίζουν στο σύνολο", () => {
    expect(() => planTender(1250, { cashCents: 700, cardCents: 500 })).toThrow(/δεν συμφωνούν/);
    expect(() => planTender(1250, { cashCents: 1300, cardCents: 0 })).toThrow(/δεν συμφωνούν/);
  });

  it("απορρίπτει λιγότερα μετρητά από το ποσό, αρνητικά και μη ακέραια ποσά", () => {
    expect(() => planTender(1250, { cashCents: 1250, cardCents: 0, tenderedCashCents: 1000 })).toThrow(/λιγότερα/);
    expect(() => planTender(1250, { cashCents: -50, cardCents: 1300 })).toThrow(/Μη έγκυρο/);
    expect(() => planTender(1250, { cashCents: 1250.5, cardCents: 0 })).toThrow();
    expect(() => planTender(1250, { cashCents: 0, cardCents: 1250, tenderedCashCents: 500 })).toThrow(/χωρίς ποσό/);
  });

  it("μηδενικό σύνολο (π.χ. κέρασμα 100%): καμία πληρωμή", () => {
    expect(planTender(0, { cashCents: 0, cardCents: 0 })).toEqual({ payments: [], changeCents: 0 });
  });
});

describe("quickAmounts", () => {
  it("ακριβώς και μετά τα επόμενα στρογγυλά ποσά", () => {
    expect(quickAmounts(1250)).toEqual([1250, 1500, 2000, 5000]);
    expect(quickAmounts(300)).toEqual([300, 500, 1000, 2000, 5000]);
    expect(quickAmounts(4730)).toEqual([4730, 5000, 6000]);
  });
  it("όταν το ποσό είναι ήδη στρογγυλό προτείνει το επόμενο χαρτονόμισμα", () => {
    expect(quickAmounts(1000)).toEqual([1000, 1500, 2000, 5000]);
    expect(quickAmounts(0)).toEqual([]);
  });
});
