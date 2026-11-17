import { beforeAll, describe, expect, it } from "vitest";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { daySummary, listRegisters, openRegisterShift } from "@/server/services/registers";
import { payOrderAtTill, quickSale, type TillEmployee } from "@/server/services/till";
import { openSession, sendRound } from "@/server/services/ordering";
import { addPayment } from "@/server/services/billing";
import { placeQrOrder } from "@/server/services/public-order";
import { financeMonth } from "@/server/services/finance";
import { salesByProduct, salesSummary, todayAthens, todayDashboard } from "@/server/services/reports";

let cashier: TillEmployee;

beforeAll(async () => {
  await seeded();
  const c = await employeeByName("Νίκος");
  cashier = { id: c.id, name: c.name, role: c.role };
});

describe("αναφορές και έσοδα με τα νέα ταμεία", () => {
  it("γρήγορη πώληση, QR στο ταμείο και παλιά πληρωμή μετριούνται ακριβώς μία φορά", async () => {
    const [r1, r2] = await listRegisters();
    const shift1 = (await openRegisterShift(r1.id, 5000, cashier.id)).id;
    const shift2 = (await openRegisterShift(r2.id, 0, cashier.id)).id;
    const burger = await productByName("Classic Burger");
    const cola = await productByName("Coca-Cola 330ml");
    const waiter = await employeeByName("Μαρία");

    // 1) Γρήγορη πώληση στο Ταμείο 1: 8,50 + 2 × 2,50 = 13,50, μοιρασμένη 5 κάρτα + 8,50 μετρητά (έδωσε 10).
    const quick = await quickSale(
      { cashSessionId: shift1, clientRef: "finance-test-quick-1", buzzerNo: 3, lines: [{ productId: burger.id, qty: 1 }, { productId: cola.id, qty: 2 }], tender: { cashCents: 850, cardCents: 500, tenderedCashCents: 1000 } },
      cashier,
    );
    expect(quick.totalCents).toBe(1350);
    // 2) Παραγγελία QR που πληρώνεται με κάρτα στο Ταμείο 2: 2 × 8,50 = 17,00.
    const qr = await placeQrOrder({ customerName: "Κώστας", lines: [{ productId: burger.id, qty: 2 }] });
    await payOrderAtTill({ sessionId: qr.sessionId, cashSessionId: shift2, buzzerNo: 4, tender: { cashCents: 0, cardCents: 1700 } }, cashier);
    // 3) Παλιά ροή (τραπέζι, πληρωμή χωρίς ταμείο): 2,50 μετρητά.
    const legacy = await openSession({ tableId: (await tableByName("Κ1")).id, covers: 2 }, waiter.id);
    await sendRound(legacy.id, [{ productId: cola.id, qty: 1 }], waiter.id);
    const lp = await addPayment(legacy.id, { method: "cash", amountCents: 250 }, cashier.id);
    expect(lp.payment.cashSessionId).toBeNull(); // δύο ανοιχτά ταμεία: δεν χρεώνεται σε κανένα
    // 4) Απλήρωτη παραγγελία QR: δεν μετρά πουθενά.
    await placeQrOrder({ customerName: "Άννα", lines: [{ productId: cola.id, qty: 10 }] });

    const today = todayAthens();
    const expected = { cash: 850 + 250, card: 500 + 1700, total: 1350 + 1700 + 250 };

    const fin = await financeMonth(today.slice(0, 7));
    expect(fin.income.pos).toEqual({ cash: expected.cash, card: expected.card, other: 0 });
    expect(fin.income.posTotal).toBe(expected.total);
    expect(fin.days.find((d) => d.date === today)?.income).toBe(expected.total);

    const sum = await salesSummary({ from: today, to: today });
    expect(sum.sessions).toBe(3);
    expect(sum.grossCents).toBe(expected.total);
    expect(sum.byMethod).toEqual({ cash: expected.cash, card: expected.card });
    expect(sum.vat.reduce((n, v) => n + v.grossCents, 0)).toBe(expected.total);
    const byProduct = await salesByProduct({ from: today, to: today });
    expect(byProduct.find((p) => p.name === "Classic Burger")?.qty).toBe(3);
    expect(byProduct.find((p) => p.name.startsWith("Coca"))?.qty).toBe(3);

    // Σύνοψη ημέρας ανά ταμείο: βάρδιες + «χωρίς ταμείο» = έσοδα ταμείου της ημέρας.
    const day = await daySummary(today);
    const t1 = day.registers.find((r) => r.name === "Ταμείο 1")!.totals;
    const t2 = day.registers.find((r) => r.name === "Ταμείο 2")!.totals;
    expect(t1).toMatchObject({ salesCount: 1, cashCents: 850, cardCents: 500, totalCents: 1350, openingFloatCents: 5000, expectedCashCents: 5850 });
    expect(t2).toMatchObject({ salesCount: 1, cashCents: 0, cardCents: 1700, totalCents: 1700 });
    expect(day.unassigned).toMatchObject({ salesCount: 1, cashCents: 250, totalCents: 250 });
    expect(day.total.totalCents).toBe(3050);
    expect(day.grandTotalCents).toBe(fin.income.posTotal);

    // Dashboard: μόνο η απλήρωτη QR είναι «ανοιχτή».
    const dash = await todayDashboard();
    expect(dash.openSessions).toBe(1);
    expect(dash.openCents).toBe(2500);
    expect(dash.summary.grossCents).toBe(expected.total);
  });
});
