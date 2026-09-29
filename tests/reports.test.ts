import { beforeAll, describe, expect, it } from "vitest";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { openSession, sendRound } from "@/server/services/ordering";
import { addPayment } from "@/server/services/billing";
import { salesSummary, salesByProduct, salesByEmployee, athensDayStart, todayAthens, todayDashboard, salesByCategory } from "@/server/services/reports";

let waiter: { id: number };
let cashier: { id: number };
beforeAll(async () => {
  await seeded();
  waiter = await employeeByName("Μαρία");
  cashier = await employeeByName("Νίκος");
});

describe("reports", () => {
  it("computes Athens day boundaries with DST", () => {
    expect(athensDayStart("2026-07-01").toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(athensDayStart("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(todayAthens()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("summarizes closed sessions of today", async () => {
    const t1 = await tableByName("Κ1");
    const t2 = await tableByName("Κ2");
    const brizola = await productByName("Classic Burger");
    const cola = await productByName("Coca-Cola 330ml");
    const s1 = await openSession({ tableId: t1.id, covers: 2 }, waiter.id);
    await sendRound(s1.id, [{ productId: brizola.id, qty: 1 }, { productId: cola.id, qty: 2 }], waiter.id);
    await addPayment(s1.id, { method: "cash", amountCents: 1350 }, cashier.id);
    const s2 = await openSession({ tableId: t2.id, covers: 1 }, waiter.id);
    await sendRound(s2.id, [{ productId: cola.id, qty: 1 }], waiter.id);
    await addPayment(s2.id, { method: "card", amountCents: 250 }, cashier.id);
    // open, unpaid session must not count
    const s3 = await openSession({ tableId: (await tableByName("Κ4")).id }, waiter.id);
    await sendRound(s3.id, [{ productId: brizola.id, qty: 5 }], waiter.id);

    const today = todayAthens();
    const sum = await salesSummary({ from: today, to: today });
    expect(sum.sessions).toBe(2);
    expect(sum.grossCents).toBe(1600);
    expect(sum.byMethod.cash).toBe(1350);
    expect(sum.byMethod.card).toBe(250);
    expect(sum.covers).toBe(3);
    expect(sum.vat.map((v) => v.ratePct)).toEqual([13, 24]);
    expect(sum.byDay).toHaveLength(1);

    const byProduct = await salesByProduct({ from: today, to: today });
    expect(byProduct[0].name).toBe("Classic Burger");
    expect(byProduct[0].qty).toBe(1);
    expect(byProduct[0].costCents).toBe(Math.round((0.35 + 1.6 + 20 * 0.002 + 30 * 0.0018 + 15 * 0.001 + 150 * 0.0021) * 100));
    expect(byProduct.find((p) => p.name.startsWith("Coca"))?.qty).toBe(3);

    const byCat = await salesByCategory({ from: today, to: today });
    expect(byCat.find((c) => c.category === "Burger")?.grossCents).toBe(850);

    const byEmp = await salesByEmployee({ from: today, to: today });
    expect(byEmp[0].name).toBe("Μαρία");
    expect(byEmp[0].grossCents).toBe(1600);

    const dash = await todayDashboard();
    expect(dash.openSessions).toBe(1);
    expect(dash.openCents).toBe(4250);
    expect(dash.pendingKitchen).toBeGreaterThan(0);
  });
});
