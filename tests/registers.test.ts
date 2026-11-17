import { beforeAll, describe, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { closeRegisterShift, daySummary, ensureDefaultRegisters, listRegisters, openRegisterShift, shiftSummary, upsertRegister } from "@/server/services/registers";
import { openSession, sendRound } from "@/server/services/ordering";
import { addPayment } from "@/server/services/billing";
import { todayAthens } from "@/server/services/reports";

let cashier: { id: number };
let admin: { id: number };

beforeAll(async () => {
  await seeded();
  cashier = await employeeByName("Νίκος");
  admin = await employeeByName("Αλέξης");
});

describe("ταμεία και βάρδιες ανά ταμείο", () => {
  it("το seed δημιουργεί «Ταμείο 1» και «Ταμείο 2»", async () => {
    const regs = await listRegisters();
    expect(regs.map((r) => r.name)).toEqual(["Ταμείο 1", "Ταμείο 2"]);
    expect(regs.every((r) => r.active && r.openShift === null)).toBe(true);
  });

  it("αυτο-ίαση: βάση χωρίς ταμεία τα ξαναφτιάχνει και υιοθετεί παλιά ανοιχτή βάρδια", async () => {
    const db = await getDb();
    await db.delete(schema.registers);
    // Παλιά βάρδια όπως την έγραφε η προηγούμενη έκδοση: χωρίς ταμείο.
    const [legacy] = await db.insert(schema.cashSessions).values({ openedBy: cashier.id, openingFloatCents: 3000 }).returning();
    expect(legacy.registerId).toBeNull();

    const regs = await listRegisters(); // δεν είναι ποτέ αδιέξοδο: δημιουργεί τα προεπιλεγμένα
    expect(regs.map((r) => r.name)).toEqual(["Ταμείο 1", "Ταμείο 2"]);
    expect(regs[0].openShift?.id).toBe(legacy.id);
    expect(regs[0].openShift?.openingFloatCents).toBe(3000);
    expect(regs[1].openShift).toBeNull();

    // Δεύτερη κλήση δεν αλλάζει τίποτα.
    await ensureDefaultRegisters(db);
    expect((await listRegisters(true)).length).toBe(2);
    await closeRegisterShift(legacy.id, 3000, cashier.id);
    expect((await listRegisters())[0].openShift).toBeNull();
  });

  it("το πολύ μία ανοιχτή βάρδια ανά ταμείο, πολλά ταμεία ανοιχτά ταυτόχρονα", async () => {
    const db = await getDb();
    const [r1, r2] = await listRegisters();
    const s1 = await openRegisterShift(r1.id, 5000, cashier.id);
    expect(s1.registerId).toBe(r1.id);
    await expect(openRegisterShift(r1.id, 1000, admin.id)).rejects.toThrow(/ήδη ανοιχτή βάρδια/);
    const s2 = await openRegisterShift(r2.id, 2000, admin.id);
    expect(s2.registerId).toBe(r2.id);

    const regs = await listRegisters();
    expect(regs.map((r) => r.openShift?.id)).toEqual([s1.id, s2.id]);
    expect(regs[0].openShift?.openedBy).toBe("Νίκος");

    // Ο κανόνας ισχύει και στη βάση (μοναδικός δείκτης), όχι μόνο στον κώδικα.
    await expect(db.insert(schema.cashSessions).values({ registerId: r1.id, openedBy: cashier.id })).rejects.toThrow();
    const open = await db.select().from(schema.cashSessions).where(isNull(schema.cashSessions.closedAt));
    expect(open).toHaveLength(2);

    await expect(openRegisterShift(999999, 0, cashier.id)).rejects.toThrow(/δεν βρέθηκε/);
    await expect(openRegisterShift(r1.id, -5, cashier.id)).rejects.toThrow(/αρχικό ταμείο/);
  });

  it("διαχείριση ταμείων: προσθήκη, μετονομασία, μοναδικό όνομα, όχι απενεργοποίηση με ανοιχτή βάρδια", async () => {
    const [r1] = await listRegisters();
    const r3 = await upsertRegister({ name: "  Ταμείο   3 " }, admin.id);
    expect(r3.name).toBe("Ταμείο 3");
    expect(r3.sort).toBe(3);
    await expect(upsertRegister({ name: "ταμείο 3" }, admin.id)).rejects.toThrow(/Υπάρχει ήδη/);
    await expect(upsertRegister({ name: " " }, admin.id)).rejects.toThrow(/όνομα/);
    const renamed = await upsertRegister({ id: r3.id, name: "Ταμείο Παιδότοπου" }, admin.id);
    expect(renamed.name).toBe("Ταμείο Παιδότοπου");

    await expect(upsertRegister({ id: r1.id, name: r1.name, active: false }, admin.id)).rejects.toThrow(/Κλείσε πρώτα τη βάρδια/);
    await upsertRegister({ id: r3.id, name: "Ταμείο Παιδότοπου", active: false }, admin.id);
    expect((await listRegisters()).map((r) => r.name)).toEqual(["Ταμείο 1", "Ταμείο 2"]);
    expect((await listRegisters(true)).map((r) => r.name)).toContain("Ταμείο Παιδότοπου");
    await expect(openRegisterShift(r3.id, 0, cashier.id)).rejects.toThrow(/απενεργοποιημένο/);
  });

  it("σύνοψη και κλείσιμο ταμείου: αναμενόμενα μετρητά, διαφορά, μισοτελειωμένη πληρωμή", async () => {
    const waiter = await employeeByName("Μαρία");
    const burger = await productByName("Classic Burger");
    const cola = await productByName("Coca-Cola 330ml");
    const [r1, r2] = await listRegisters();
    const shift1 = r1.openShift!.id;
    const shift2 = r2.openShift!.id;

    // 8,50 + 2×2,50 = 13,50 μετρητά στο Ταμείο 1 (ο πελάτης έδωσε 20, ρέστα 6,50: τα ρέστα δεν μετράνε στα αναμενόμενα).
    const a = await openSession({ tableId: (await tableByName("Κ1")).id }, waiter.id);
    await sendRound(a.id, [{ productId: burger.id, qty: 1 }, { productId: cola.id, qty: 2 }], waiter.id);
    const pay = await addPayment(a.id, { method: "cash", amountCents: 1350, tenderedCents: 2000 }, cashier.id, { cashSessionId: shift1 });
    expect(pay.payment.cashSessionId).toBe(shift1);
    expect(pay.changeCents).toBe(650);
    // 2,50 κάρτα στο Ταμείο 2.
    const b = await openSession({ tableId: (await tableByName("Κ2")).id }, waiter.id);
    await sendRound(b.id, [{ productId: cola.id, qty: 1 }], waiter.id);
    await addPayment(b.id, { method: "card", amountCents: 250 }, cashier.id, { cashSessionId: shift2 });
    // Μισή πληρωμή (5 από 8,50) στο Ταμείο 1.
    const c = await openSession({ tableId: (await tableByName("Κ4")).id }, waiter.id);
    await sendRound(c.id, [{ productId: burger.id, qty: 1 }], waiter.id);
    await addPayment(c.id, { method: "cash", amountCents: 500 }, cashier.id, { cashSessionId: shift1 });

    let sum = await shiftSummary(shift1);
    expect(sum.registerName).toBe("Ταμείο 1");
    expect(sum.salesCount).toBe(2);
    expect(sum.byMethod.cash).toEqual({ totalCents: 1850, count: 2 });
    expect(sum.byMethod.card).toEqual({ totalCents: 0, count: 0 });
    expect(sum.byMethod.other).toEqual({ totalCents: 0, count: 0 });
    expect(sum.expectedCashCents).toBe(5000 + 1850);
    expect(sum.diffCents).toBeNull();

    // Δεν κλείνει με μισοτελειωμένη πληρωμή.
    await expect(closeRegisterShift(shift1, 6850, cashier.id)).rejects.toThrow(/μισοτελειωμένη/);
    await addPayment(c.id, { method: "card", amountCents: 350 }, cashier.id, { cashSessionId: shift1 });

    // Με δύο ανοιχτά ταμεία, πληρωμή χωρίς ρητό ταμείο δεν χρεώνεται «στην τύχη» σε κάποιο.
    const d = await openSession({ tableId: (await tableByName("Κ5")).id }, waiter.id);
    await sendRound(d.id, [{ productId: cola.id, qty: 2 }], waiter.id);
    const loose = await addPayment(d.id, { method: "cash", amountCents: 500 }, cashier.id);
    expect(loose.payment.cashSessionId).toBeNull();

    // Μετρήθηκαν 68,00 αντί 68,50: έλλειμμα 0,50.
    await expect(closeRegisterShift(shift1, -1, cashier.id)).rejects.toThrow(/μέτρησες/);
    const closed = await closeRegisterShift(shift1, 6800, cashier.id, "  έλειπε ένα 50λεπτο ");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedBy).toBe("Νίκος");
    expect(closed.salesCount).toBe(2);
    expect(closed.byMethod.card).toEqual({ totalCents: 350, count: 1 });
    expect(closed.totalCents).toBe(2200);
    expect(closed.expectedCashCents).toBe(6850);
    expect(closed.countedCashCents).toBe(6800);
    expect(closed.diffCents).toBe(-50);
    expect(closed.notes).toBe("έλειπε ένα 50λεπτο");
    await expect(closeRegisterShift(shift1, 6800, cashier.id)).rejects.toThrow(/ήδη κλείσει/);
    // Σε κλειστή βάρδια δεν γράφεται άλλη πληρωμή.
    const e = await openSession({ tableId: (await tableByName("Κ6")).id }, waiter.id);
    await sendRound(e.id, [{ productId: cola.id, qty: 1 }], waiter.id);
    await expect(addPayment(e.id, { method: "cash", amountCents: 250 }, cashier.id, { cashSessionId: shift1 })).rejects.toThrow(/έχει κλείσει/);

    const db = await getDb();
    const audit = await db.query.auditLog.findMany({ where: eq(schema.auditLog.action, "cash_close") });
    expect(audit.at(-1)?.details).toMatchObject({ registerId: r1.id, countedCashCents: 6800, expectedCashCents: 6850, diff: -50 });

    // Το ταμείο ξανανοίγει με νέα βάρδια.
    sum = await shiftSummary(shift2);
    expect(sum.byMethod.card.totalCents).toBe(250);
    const again = await openRegisterShift(r1.id, 6800, cashier.id);
    expect(again.id).not.toBe(shift1);
  });

  it("σύνοψη ημέρας: κάθε βάρδια ανά ταμείο, γενικό σύνολο και πληρωμές χωρίς ταμείο", async () => {
    const today = todayAthens();
    const day = await daySummary(today);
    const t1 = day.registers.find((r) => r.name === "Ταμείο 1")!;
    const t2 = day.registers.find((r) => r.name === "Ταμείο 2")!;
    // Ταμείο 1: η υιοθετημένη παλιά βάρδια, η βάρδια που έκλεισε με έλλειμμα και η νέα ανοιχτή.
    expect(t1.shifts).toHaveLength(3);
    expect(t1.totals.salesCount).toBe(2);
    expect(t1.totals.cashCents).toBe(1850);
    expect(t1.totals.cardCents).toBe(350);
    expect(t1.totals.totalCents).toBe(2200);
    expect(t1.totals.diffCents).toBe(-50);
    expect(t1.totals.openShifts).toBe(1);
    expect(t2.shifts).toHaveLength(1);
    expect(t2.totals.cardCents).toBe(250);
    expect(t2.totals.openShifts).toBe(1);
    // Το απενεργοποιημένο ταμείο χωρίς βάρδιες δεν εμφανίζεται.
    expect(day.registers.map((r) => r.name)).toEqual(["Ταμείο 1", "Ταμείο 2"]);

    expect(day.unassigned).toMatchObject({ salesCount: 1, cashCents: 500, totalCents: 500 });
    expect(day.total.totalCents).toBe(2450);
    expect(day.total.salesCount).toBe(3);
    expect(day.total.shifts).toBe(4);
    expect(day.grandTotalCents).toBe(2950);

    const db = await getDb();
    const all = await db.select().from(schema.payments);
    expect(day.grandTotalCents).toBe(all.reduce((n, p) => n + p.amountCents, 0));

    const empty = await daySummary("2020-01-01");
    expect(empty.total.shifts).toBe(0);
    expect(empty.grandTotalCents).toBe(0);
    await expect(daySummary("x")).rejects.toThrow(/ημερομηνία/);
  });
});
