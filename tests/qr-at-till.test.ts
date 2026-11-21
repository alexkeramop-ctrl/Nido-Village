import { beforeAll, describe, expect, it } from "vitest";
import { saveSettings } from "@/server/services/settings";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, modifierByName, tableByName } from "./helpers";
import { listRegisters, openRegisterShift, shiftSummary } from "@/server/services/registers";
import { listPendingForTill, payOrderAtTill, tillSnapshot, type TillEmployee } from "@/server/services/till";
import { bumpOrder, getKdsTickets, openSession, sendRound } from "@/server/services/ordering";
import { getSessionDetail } from "@/server/services/billing";
import { getPublicOrder, listPickupBoard, markPickedUp, placeQrOrder } from "@/server/services/public-order";

let cashier: TillEmployee;
let manager: TillEmployee;
let shift1: number;
let shift2: number;
let register2: number;

beforeAll(async () => {
  await seeded();
  // Οι παραγγελίες QR είναι κλειστές στην παραγωγή (μόνο μενού)· εδώ ελέγχεται ο μηχανισμός για όταν ανοίξουν.
  await saveSettings({ qrOrdering: true, qrPrintAfterPayment: false });
  const c = await employeeByName("Νίκος");
  const m = await employeeByName("Ελένη");
  cashier = { id: c.id, name: c.name, role: c.role };
  manager = { id: m.id, name: m.name, role: m.role };
  const [r1, r2] = await listRegisters();
  register2 = r2.id;
  shift1 = (await openRegisterShift(r1.id, 0, cashier.id)).id;
  shift2 = (await openRegisterShift(r2.id, 1000, cashier.id)).id;
});

describe("παραγγελία QR που πληρώνεται στο ταμείο", () => {
  it("εμφανίζεται στο «Προς πληρωμή», πληρώνεται με βομβητή στο Ταμείο 2 και η ετοιμασία συνεχίζεται", async () => {
    const db = await getDb();
    const burger = await productByName("Classic Burger");
    const cola = await productByName("Coca-Cola 330ml");
    const cheese = await modifierByName("Extra τυρί");
    const r = await placeQrOrder({ customerName: "Κώστας", lines: [{ productId: burger.id, qty: 2, modifierIds: [cheese.id] }, { productId: cola.id, qty: 1 }] });

    let pending = await listPendingForTill();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ sessionId: r.sessionId, qr: true, code: "001", customerName: "Κώστας", itemCount: 3, totalCents: 2150, dueCents: 2150, partial: false, ready: false });
    expect(pending[0].lines.map((l) => [l.qty, l.name, l.modifiers, l.lineTotalCents])).toEqual([
      [2, "Classic Burger", ["Extra τυρί"], 1900],
      [1, "Coca-Cola 330ml", [], 250],
    ]);
    const jobsBefore = (await db.query.printJobs.findMany()).length;

    // Λάθος ποσό / έκπτωση από ταμία: τίποτα δεν αλλάζει.
    await expect(payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift2, buzzerNo: 5, tender: { cashCents: 2000, cardCents: 0 } }, cashier)).rejects.toThrow(/δεν συμφωνούν/);
    await expect(
      payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift2, discount: { cents: 150, reason: "Κέρασμα" }, tender: { cashCents: 2000, cardCents: 0 } }, cashier),
    ).rejects.toThrow(/υπεύθυνος/);
    await expect(payOrderAtTill({ sessionId: r.sessionId, cashSessionId: 999999, tender: { cashCents: 2150, cardCents: 0 } }, cashier)).rejects.toThrow(/βάρδια/);
    let d = (await getSessionDetail(r.sessionId))!;
    expect(d.status).toBe("open");
    expect(d.payments).toHaveLength(0);
    expect(d.buzzerNo).toBeNull();

    // Μοιρασμένη: 10 κάρτα + 11,50 μετρητά (έδωσε 20, ρέστα 8,50), βομβητής 5, στο Ταμείο 2.
    const res = await payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift2, buzzerNo: 5, tender: { cashCents: 1150, cardCents: 1000, tenderedCashCents: 2000 } }, cashier);
    expect(res).toMatchObject({ sessionId: r.sessionId, totalCents: 2150, changeCents: 850, buzzerNo: 5, displayNo: "Βομβητής 5" });

    d = (await getSessionDetail(r.sessionId))!;
    expect(d.status).toBe("closed");
    expect(d.buzzerNo).toBe(5);
    expect(d.totals.dueCents).toBe(0);
    expect(d.payments.map((p) => [p.method, p.amountCents, p.cashSessionId])).toEqual([
      ["card", 1000, shift2],
      ["cash", 1150, shift2],
    ]);
    const s2 = await shiftSummary(shift2);
    expect(s2.registerName).toBe("Ταμείο 2");
    expect(s2.salesCount).toBe(1);
    expect(s2.totalCents).toBe(2150);
    expect(s2.expectedCashCents).toBe(1000 + 1150);
    expect((await shiftSummary(shift1)).totalCents).toBe(0);

    // Η δημόσια σελίδα: πληρωμένη αλλά ΟΧΙ «ολοκληρωμένη» — ακόμη ετοιμάζεται, με τον βομβητή της.
    let o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("received");
    expect(o.paid).toBe(true);
    expect(o.buzzerNo).toBe(5);

    // Κουζίνα και μπαρ μαθαίνουν τον βομβητή: μικρό δελτίο + στην οθόνη.
    const jobs = await db.query.printJobs.findMany({ with: { station: true } });
    const slips = jobs.slice(jobsBefore);
    expect(slips.map((j) => j.station.name).sort()).toEqual(["Κουζίνα", "Μπαρ Κέντρο"]);
    expect(slips.every((j) => j.renderedText!.includes("ΒΟΜΒΗΤΗΣ 5") && j.renderedText!.includes("#001 Κώστας"))).toBe(true);
    const ticket = (await getKdsTickets()).find((t) => t.sessionId === r.sessionId)!;
    expect(ticket).toMatchObject({ buzzerNo: 5, paid: true, source: "qr" });

    // Πίνακας παραλαβών: με τον βομβητή, στα «ετοιμάζονται».
    expect((await listPickupBoard()).map((b) => [b.code, b.buzzerNo, b.status, b.paid])).toEqual([["001", 5, "received", true]]);
    // Δεν είναι πια «προς πληρωμή» και δεν πληρώνεται δεύτερη φορά.
    pending = await listPendingForTill();
    expect(pending).toHaveLength(0);
    await expect(payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift1, tender: { cashCents: 0, cardCents: 0 } }, cashier)).rejects.toThrow(/ήδη πληρωθεί/);

    await bumpOrder(ticket.orderId);
    o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("ready");
    expect((await listPickupBoard())[0].status).toBe("ready");

    await markPickedUp(r.sessionId);
    o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("done");
    expect(await listPickupBoard()).toHaveLength(0);
  });

  it("έκπτωση από υπεύθυνο στην πληρωμή· το στιγμιότυπο του ταμείου δείχνει εκκρεμείς, βάρδια και εξαντλημένα", async () => {
    const db = await getDb();
    const cola = await productByName("Coca-Cola 330ml");
    const pizza = await productByName("Kids Πίτσα");
    const r = await placeQrOrder({ customerName: "Ελένη", lines: [{ productId: cola.id, qty: 4 }] });
    await db.update(schema.products).set({ available: false }).where(eq(schema.products.id, pizza.id));

    const snap = await tillSnapshot(register2);
    expect(snap.pending.map((p) => p.sessionId)).toEqual([r.sessionId]);
    expect(snap.shift).toMatchObject({ id: shift2, registerName: "Ταμείο 2", salesCount: 1 });
    expect(typeof snap.shift!.openedAt).toBe("string");
    expect(snap.unavailableIds).toEqual([pizza.id]);

    // 10,00 − 2,00 = 8,00
    await expect(payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift1, discount: { cents: 200, reason: "" }, tender: { cashCents: 800, cardCents: 0 } }, manager)).rejects.toThrow(/αιτιολογία/);
    const res = await payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift1, discount: { cents: 200, reason: "Παράπονο πελάτη" }, tender: { cashCents: 800, cardCents: 0 } }, manager);
    expect(res.totalCents).toBe(800);
    expect(res.buzzerNo).toBeNull();
    expect(res.displayNo).toBe("#002 Ελένη");
    const d = (await getSessionDetail(r.sessionId))!;
    expect(d.status).toBe("closed");
    expect(d.totals.discountCents).toBe(200);
    expect(d.totals.totalCents).toBe(800);
    expect(d.payments[0].cashSessionId).toBe(shift1);
    expect((await shiftSummary(shift1)).byMethod.cash.totalCents).toBe(800);
  });

  it("παλιός ανοιχτός λογαριασμός τραπεζιού πληρώνεται επίσης από το ταμείο (δεν είναι αδιέξοδο)", async () => {
    const waiter = await employeeByName("Μαρία");
    const cola = await productByName("Coca-Cola 330ml");
    const s = await openSession({ tableId: (await tableByName("Κ7")).id }, waiter.id);
    await sendRound(s.id, [{ productId: cola.id, qty: 2 }], waiter.id);
    // Άδειο τραπέζι: δεν εμφανίζεται ως «προς πληρωμή».
    await openSession({ tableId: (await tableByName("Κ8")).id }, waiter.id);

    const pending = await listPendingForTill();
    expect(pending.map((p) => [p.name, p.qr, p.dueCents])).toEqual([["Κ7", false, 500]]);
    const res = await payOrderAtTill({ sessionId: s.id, cashSessionId: shift2, tender: { cashCents: 0, cardCents: 500 } }, cashier);
    expect(res.displayNo).toBe("Κ7");
    expect((await getSessionDetail(s.id))!.status).toBe("closed");
    expect(await listPendingForTill()).toHaveLength(0);
  });
});
