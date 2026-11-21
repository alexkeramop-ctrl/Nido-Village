import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, ingredientByName, modifierByName } from "./helpers";
import { closeRegisterShift, listRegisters, openRegisterShift, shiftSummary } from "@/server/services/registers";
import { quickSale, topProducts, type TillEmployee } from "@/server/services/till";
import { bumpOrder, getKdsTickets } from "@/server/services/ordering";
import { getSessionDetail } from "@/server/services/billing";
import { getPublicOrder, listPickupBoard, listReadyForPickup, markPickedUp } from "@/server/services/public-order";
import { num } from "@/server/money";

let cashier: TillEmployee;
let manager: TillEmployee;
let shift1: number;
let shift2: number;
let burger: { id: number };
let cola: { id: number };
let extraCheese: { id: number };

async function counts() {
  const db = await getDb();
  const n = async (t: PgTable) => {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t);
    return r.n;
  };
  return {
    sessions: await n(schema.tableSessions),
    orders: await n(schema.orders),
    items: await n(schema.orderItems),
    payments: await n(schema.payments),
    printJobs: await n(schema.printJobs),
    stockMovements: await n(schema.stockMovements),
    fiscal: await n(schema.fiscalDocuments),
  };
}

let refSeq = 0;
const ref = () => `test-sale-${++refSeq}-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  await seeded();
  const c = await employeeByName("Νίκος");
  const m = await employeeByName("Ελένη");
  cashier = { id: c.id, name: c.name, role: c.role };
  manager = { id: m.id, name: m.name, role: m.role };
  const [r1, r2] = await listRegisters();
  shift1 = (await openRegisterShift(r1.id, 5000, cashier.id)).id;
  shift2 = (await openRegisterShift(r2.id, 2000, manager.id)).id;
  burger = await productByName("Classic Burger");
  cola = await productByName("Coca-Cola 330ml");
  extraCheese = await modifierByName("Extra τυρί");
});

describe("γρήγορη πώληση ταμείου", () => {
  it("«Συχνά» χωρίς ιστορικό: κενή λίστα (το ταμείο δείχνει τα πρώτα είδη του μενού)", async () => {
    expect(await topProducts()).toEqual([]);
  });

  it("μία επιβεβαίωση: παραγγελία σε κουζίνα και μπαρ, πληρωμή στη βάρδια, κλειστός λογαριασμός, σωστά σύνολα", async () => {
    const db = await getDb();
    const beefBefore = num((await ingredientByName("Μπιφτέκι μοσχαρίσιο 150g")).stockQty);
    const cheddarBefore = num((await ingredientByName("Τυρί cheddar (φέτες)")).stockQty);
    const colaBefore = num((await ingredientByName("Coca-Cola 330ml")).stockQty);

    const res = await quickSale(
      {
        cashSessionId: shift1,
        clientRef: ref(),
        buzzerNo: 12,
        customerName: " Κώστας ",
        lines: [
          { productId: burger.id, qty: 2, modifierIds: [extraCheese.id], notes: "καλοψημένο" },
          { productId: cola.id, qty: 3 },
        ],
        tender: { cashCents: 2650, cardCents: 0, tenderedCashCents: 3000 },
      },
      cashier,
    );
    // 2 × (8,50 + 1,00) + 3 × 2,50 = 26,50 · δόθηκαν 30 · ρέστα 3,50
    expect(res).toMatchObject({ totalCents: 2650, changeCents: 350, buzzerNo: 12, displayNo: "Βομβητής 12", duplicate: false });
    expect(res.payments).toEqual([{ method: "cash", amountCents: 2650 }]);

    const d = (await getSessionDetail(res.sessionId))!;
    expect(d.status).toBe("closed");
    expect(d.source).toBe("till");
    expect(d.buzzerNo).toBe(12);
    expect(d.customerName).toBe("Κώστας");
    expect(d.closedAt).not.toBeNull();
    expect(d.orders).toHaveLength(1);
    expect(d.items).toHaveLength(2);
    expect(d.items.every((i) => i.status === "sent")).toBe(true);
    expect(d.items.find((i) => i.productId === burger.id)!.modifiers.map((m) => m.nameSnapshot)).toEqual(["Extra τυρί"]);
    expect(d.items.find((i) => i.productId === burger.id)!.notes).toBe("καλοψημένο");
    expect(d.totals.subtotalCents).toBe(2650);
    expect(d.totals.totalCents).toBe(2650);
    expect(d.totals.dueCents).toBe(0);
    expect(d.totals.vat.map((v) => v.ratePct)).toEqual([13, 24]);
    expect(d.totals.vat.reduce((n, v) => n + v.grossCents, 0)).toBe(2650);
    for (const v of d.totals.vat) expect(v.netCents + v.vatCents).toBe(v.grossCents);
    expect(d.totals.vat.find((v) => v.ratePct === 13)!.grossCents).toBe(1900);
    expect(d.totals.vat.find((v) => v.ratePct === 24)!.grossCents).toBe(750);

    // Πληρωμή στη βάρδια του Ταμείου 1 (ποσό καθαρό από ρέστα).
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ cashSessionId: shift1, method: "cash", amountCents: 2650, tenderedCents: 3000, changeCents: 350, employeeId: cashier.id });

    // Δελτία: ένα στην κουζίνα και ένα στο μπαρ, με τον βομβητή σε μεγάλα γράμματα.
    const jobs = await db.query.printJobs.findMany({ with: { station: true } });
    expect(jobs.map((j) => j.station.name).sort()).toEqual(["Κουζίνα", "Μπαρ Κέντρο"]);
    const kitchen = jobs.find((j) => j.station.name === "Κουζίνα")!;
    expect(kitchen.kind).toBe("kitchen_ticket");
    expect(kitchen.renderedText).toContain("ΒΟΜΒΗΤΗΣ 12");
    expect(kitchen.renderedText).toContain("ΤΑΜΕΙΟ Κώστας");
    expect(kitchen.renderedText).toContain("2 X CLASSIC BURGER");
    expect(kitchen.renderedText).toContain("+ Extra τυρί");
    expect(kitchen.renderedText).toContain("** καλοψημένο");
    expect(kitchen.renderedText).not.toContain("COCA");
    const bar = jobs.find((j) => j.station.name === "Μπαρ Κέντρο")!;
    expect(bar.renderedText).toContain("ΒΟΜΒΗΤΗΣ 12");
    expect(bar.renderedText).toContain("3 X COCA-COLA 330ML");

    // Αποθήκη: 2 μπιφτέκια, 2 φέτες cheddar (extra τυρί), 3 cola.
    expect(num((await ingredientByName("Μπιφτέκι μοσχαρίσιο 150g")).stockQty)).toBeCloseTo(beefBefore - 2, 3);
    expect(num((await ingredientByName("Τυρί cheddar (φέτες)")).stockQty)).toBeCloseTo(cheddarBefore - 2, 3);
    expect(num((await ingredientByName("Coca-Cola 330ml")).stockQty)).toBeCloseTo(colaBefore - 3, 3);

    // Οθόνη κουζίνας/μπαρ: εισιτήριο με βομβητή, ήδη πληρωμένο.
    const tickets = await getKdsTickets();
    const t = tickets.find((x) => x.sessionId === res.sessionId)!;
    expect(t).toMatchObject({ buzzerNo: 12, customerName: "Κώστας", source: "till", paid: true, waiter: "Νίκος" });
    expect(t.items).toHaveLength(2);

    // Φορολογικά: ένα δελτίο παραγγελίας και μία απόδειξη (καταγραφή, χωρίς πάροχο).
    const fd = await db.query.fiscalDocuments.findMany({ where: eq(schema.fiscalDocuments.sessionId, res.sessionId) });
    expect(fd.map((f) => f.kind).sort()).toEqual(["order_slip_8_6", "receipt_11_1"]);

    // Ιστορικό.
    const audit = await db.query.auditLog.findMany({ where: and(eq(schema.auditLog.entity, "table_session"), eq(schema.auditLog.entityId, res.sessionId)) });
    expect(audit.map((a) => a.action).sort()).toEqual(["payment", "quick_sale"]);

    const sum = await shiftSummary(shift1);
    expect(sum.salesCount).toBe(1);
    expect(sum.byMethod.cash).toEqual({ totalCents: 2650, count: 1 });
    expect(sum.expectedCashCents).toBe(5000 + 2650);
  });

  it("ατομικότητα: αν αποτύχει οτιδήποτε δεν μένει τίποτα (ούτε παραγγελία, ούτε πληρωμή, ούτε δελτίο, ούτε απόθεμα)", async () => {
    const db = await getDb();
    const before = await counts();
    const colaBefore = num((await ingredientByName("Coca-Cola 330ml")).stockQty);
    const base = { cashSessionId: shift1, lines: [{ productId: cola.id, qty: 2 }] };

    // Πληρωμή που δεν συμφωνεί με το σύνολο (5,00).
    await expect(quickSale({ ...base, clientRef: ref(), tender: { cashCents: 400, cardCents: 0 } }, cashier)).rejects.toThrow(/δεν συμφωνούν/);
    await expect(quickSale({ ...base, clientRef: ref(), tender: { cashCents: 500, cardCents: 0, tenderedCashCents: 300 } }, cashier)).rejects.toThrow(/λιγότερα/);
    // Εξαντλημένο είδος.
    const pizza = await productByName("Kids Πίτσα");
    await db.update(schema.products).set({ available: false }).where(eq(schema.products.id, pizza.id));
    await expect(
      quickSale({ cashSessionId: shift1, clientRef: ref(), lines: [{ productId: cola.id, qty: 1 }, { productId: pizza.id, qty: 1 }], tender: { cashCents: 0, cardCents: 950 } }, cashier),
    ).rejects.toThrow(/εξαντληθεί/);
    // Μη έγκυρη επιλογή για το είδος.
    await expect(
      quickSale({ cashSessionId: shift1, clientRef: ref(), lines: [{ productId: cola.id, qty: 1, modifierIds: [extraCheese.id] }], tender: { cashCents: 0, cardCents: 350 } }, cashier),
    ).rejects.toThrow(/Μη έγκυρη επιλογή/);
    // Άδειο καλάθι, λάθος βομβητής.
    await expect(quickSale({ cashSessionId: shift1, clientRef: ref(), lines: [], tender: { cashCents: 0, cardCents: 0 } }, cashier)).rejects.toThrow(/άδειο/);
    await expect(quickSale({ ...base, clientRef: ref(), buzzerNo: 1000, tender: { cashCents: 500, cardCents: 0 } }, cashier)).rejects.toThrow(/βομβητής/);
    // Κλειστή/ανύπαρκτη βάρδια: η αποτυχία έρχεται ΜΕΣΑ στη συναλλαγή.
    await expect(quickSale({ ...base, cashSessionId: 999999, clientRef: ref(), tender: { cashCents: 500, cardCents: 0 } }, cashier)).rejects.toThrow(/βάρδια του ταμείου έχει κλείσει/);
    // Αποτυχία ΜΕΤΑ τις εγγραφές παραγγελίας/δελτίων (η πληρωμή σκοντάφτει σε άγνωστο υπάλληλο): όλα αναιρούνται.
    await expect(quickSale({ ...base, clientRef: ref(), tender: { cashCents: 500, cardCents: 0 } }, { id: 999999, name: "Άγνωστος", role: "cashier" })).rejects.toThrow();

    expect(await counts()).toEqual(before);
    expect(num((await ingredientByName("Coca-Cola 330ml")).stockQty)).toBeCloseTo(colaBefore, 3);
    expect(await getKdsTickets()).toHaveLength(1);
  });

  it("διπλή αποστολή με το ίδιο κλειδί δεν δημιουργεί δεύτερη πώληση", async () => {
    const before = await counts();
    const clientRef = ref();
    const input = { cashSessionId: shift1, clientRef, buzzerNo: 7, lines: [{ productId: cola.id, qty: 2 }], tender: { cashCents: 500, cardCents: 0, tenderedCashCents: 1000 } };
    const first = await quickSale(input, cashier);
    expect(first.duplicate).toBe(false);
    const again = await quickSale(input, cashier);
    expect(again).toMatchObject({ sessionId: first.sessionId, duplicate: true, totalCents: 500, changeCents: 500, buzzerNo: 7 });
    // Και δύο ταυτόχρονα πατήματα: πάλι μία πώληση.
    const ref2 = ref();
    const both = await Promise.all([1, 2].map(() => quickSale({ ...input, clientRef: ref2, buzzerNo: 8 }, cashier)));
    expect(both[0].sessionId).toBe(both[1].sessionId);
    expect(both.filter((b) => b.duplicate)).toHaveLength(1);

    const after = await counts();
    expect(after.sessions).toBe(before.sessions + 2);
    expect(after.payments).toBe(before.payments + 2);
    expect(after.printJobs).toBe(before.printJobs + 2);
    expect(after.fiscal).toBe(before.fiscal + 4);
    await expect(quickSale({ ...input, clientRef: "x" }, cashier)).rejects.toThrow(/αναγνωριστικό/);
  });

  it("μοιρασμένη πληρωμή: δύο εγγραφές, μετρητά και κάρτα στη σωστή βάρδια", async () => {
    const before = await shiftSummary(shift1);
    // 2 × 8,50 = 17,00: 10 κάρτα + 7 μετρητά (έδωσε 10, ρέστα 3).
    const res = await quickSale(
      { cashSessionId: shift1, clientRef: ref(), lines: [{ productId: burger.id, qty: 2 }], tender: { cashCents: 700, cardCents: 1000, tenderedCashCents: 1000 } },
      cashier,
    );
    expect(res.totalCents).toBe(1700);
    expect(res.changeCents).toBe(300);
    expect(res.displayNo).toBe(`#${res.sessionId}`);
    const d = (await getSessionDetail(res.sessionId))!;
    expect(d.status).toBe("closed");
    expect(d.payments.map((p) => [p.method, p.amountCents, p.changeCents, p.cashSessionId])).toEqual([
      ["card", 1000, 0, shift1],
      ["cash", 700, 300, shift1],
    ]);
    const after = await shiftSummary(shift1);
    expect(after.salesCount).toBe(before.salesCount + 1);
    expect(after.byMethod.cash.totalCents).toBe(before.byMethod.cash.totalCents + 700);
    expect(after.byMethod.card.totalCents).toBe(before.byMethod.card.totalCents + 1000);
    expect(after.expectedCashCents).toBe(before.expectedCashCents + 700);
    // Χωρίς βομβητή: το δελτίο κουζίνας δείχνει «ΤΑΜΕΙΟ #αριθμός».
    const db = await getDb();
    const jobs = await db.query.printJobs.findMany();
    expect(jobs.at(-1)!.renderedText).toContain(`ΤΑΜΕΙΟ #${res.sessionId}`);
    expect(jobs.at(-1)!.renderedText).not.toContain("ΒΟΜΒΗΤΗΣ");
  });

  it("έκπτωση μόνο από υπεύθυνο/διαχειριστή, με αιτιολογία", async () => {
    const db = await getDb();
    const before = await counts();
    const sale = { cashSessionId: shift1, lines: [{ productId: burger.id, qty: 1 }, { productId: cola.id, qty: 1 }] };
    await expect(quickSale({ ...sale, clientRef: ref(), discount: { cents: 100, reason: "Κέρασμα" }, tender: { cashCents: 1000, cardCents: 0 } }, cashier)).rejects.toThrow(/υπεύθυνος/);
    await expect(quickSale({ ...sale, clientRef: ref(), discount: { cents: 100, reason: " " }, tender: { cashCents: 1000, cardCents: 0 } }, manager)).rejects.toThrow(/αιτιολογία/);
    expect(await counts()).toEqual(before);

    // 8,50 + 2,50 = 11,00 − 1,00 = 10,00
    const res = await quickSale({ ...sale, clientRef: ref(), discount: { cents: 100, reason: "Παράπονο πελάτη" }, tender: { cashCents: 0, cardCents: 1000 } }, manager);
    expect(res.totalCents).toBe(1000);
    const d = (await getSessionDetail(res.sessionId))!;
    expect(d.discountCents).toBe(100);
    expect(d.discountReason).toBe("Παράπονο πελάτη");
    expect(d.discountBy).toBe(manager.id);
    expect(d.totals.totalCents).toBe(1000);
    expect(d.totals.vat.reduce((n, v) => n + v.grossCents, 0)).toBe(1000);
    const audit = await db.query.auditLog.findMany({ where: and(eq(schema.auditLog.entity, "table_session"), eq(schema.auditLog.entityId, res.sessionId)) });
    expect(audit.map((a) => a.action).sort()).toEqual(["discount", "payment", "quick_sale"]);
    // Το ποσό της πληρωμής πρέπει να συμφωνεί με το σύνολο ΜΕΤΑ την έκπτωση.
    await expect(quickSale({ ...sale, clientRef: ref(), discount: { cents: 100, reason: "Κέρασμα" }, tender: { cashCents: 0, cardCents: 1100 } }, manager)).rejects.toThrow(/δεν συμφωνούν/);
    // Κέρασμα 100%: καμία πληρωμή, κλειστός λογαριασμός.
    const free = await quickSale({ cashSessionId: shift1, clientRef: ref(), lines: [{ productId: cola.id, qty: 1 }], discount: { cents: 9999, reason: "Κέρασμα" }, tender: { cashCents: 0, cardCents: 0 } }, manager);
    expect(free.totalCents).toBe(0);
    expect(free.payments).toEqual([]);
    expect((await getSessionDetail(free.sessionId))!.status).toBe("closed");
  });

  it("βομβητής: δεν δίνεται δύο φορές όσο ετοιμάζεται, ελευθερώνεται όταν η παραγγελία είναι έτοιμη", async () => {
    const sale = { cashSessionId: shift1, lines: [{ productId: cola.id, qty: 1 }] };
    const before = await counts();
    // Ο 12 είναι ακόμη στην πρώτη παραγγελία (ετοιμάζεται).
    await expect(quickSale({ ...sale, clientRef: ref(), buzzerNo: 12, tender: { cashCents: 0, cardCents: 250 } }, cashier)).rejects.toThrow(/Ο βομβητής 12 είναι ακόμη σε χρήση/);
    expect(await counts()).toEqual(before);

    const first = (await getKdsTickets()).find((t) => t.buzzerNo === 12)!;
    // Ο πίνακας παραλαβών δείχνει τον βομβητή όσο ετοιμάζεται.
    const board = await listPickupBoard();
    expect(board.find((b) => b.sessionId === first.sessionId)).toMatchObject({ buzzerNo: 12, status: "received", paid: true });
    // Πωλήσεις χωρίς βομβητή δεν γεμίζουν τον πίνακα.
    expect(board.every((b) => b.buzzerNo !== null)).toBe(true);

    await bumpOrder(first.orderId); // «ΕΤΟΙΜΟ» = χτυπά ο βομβητής
    expect((await listPickupBoard()).find((b) => b.sessionId === first.sessionId)?.status).toBe("ready");
    expect((await listReadyForPickup()).map((r) => r.name)).toContain("Βομβητής 12");

    // Ο βομβητής γύρισε στο ταμείο και ξαναδίνεται: η προηγούμενη παραγγελία σημειώνεται παραδομένη.
    const next = await quickSale({ ...sale, clientRef: ref(), buzzerNo: 12, tender: { cashCents: 0, cardCents: 250 } }, cashier);
    expect(next.buzzerNo).toBe(12);
    const old = (await getSessionDetail(first.sessionId))!;
    expect(old.pickedUpAt).not.toBeNull();
    expect(old.items.every((i) => i.status === "served")).toBe(true);
    const boardAfter = await listPickupBoard();
    expect(boardAfter.find((b) => b.sessionId === first.sessionId)).toBeUndefined();
    expect(boardAfter.find((b) => b.sessionId === next.sessionId)).toMatchObject({ buzzerNo: 12, status: "received" });

    // «Παραδόθηκε» από το ταμείο/κουζίνα.
    await markPickedUp(next.sessionId);
    expect((await listPickupBoard()).find((b) => b.sessionId === next.sessionId)).toBeUndefined();
    expect(await getPublicOrder("")).toBeNull();
  });

  it("κάθε ταμείο έχει τις δικές του πωλήσεις· σε κλειστή βάρδια δεν γίνεται πώληση", async () => {
    const s1Before = await shiftSummary(shift1);
    const res = await quickSale({ cashSessionId: shift2, clientRef: ref(), buzzerNo: 30, lines: [{ productId: cola.id, qty: 4 }], tender: { cashCents: 1000, cardCents: 0 } }, manager);
    const d = (await getSessionDetail(res.sessionId))!;
    expect(d.payments[0].cashSessionId).toBe(shift2);
    const s2 = await shiftSummary(shift2);
    expect(s2.registerName).toBe("Ταμείο 2");
    expect(s2.salesCount).toBe(1);
    expect(s2.byMethod.cash.totalCents).toBe(1000);
    expect(s2.expectedCashCents).toBe(2000 + 1000);
    const s1After = await shiftSummary(shift1);
    expect(s1After.totalCents).toBe(s1Before.totalCents);
    expect(s1After.salesCount).toBe(s1Before.salesCount);

    // «Συχνά»: τα πιο πουλημένα πρώτα.
    const top = await topProducts(3);
    expect(top[0]).toBe(cola.id);
    expect(top).toContain(burger.id);

    const closed = await closeRegisterShift(shift2, 3000, manager.id);
    expect(closed.diffCents).toBe(0);
    const before = await counts();
    await expect(quickSale({ cashSessionId: shift2, clientRef: ref(), lines: [{ productId: cola.id, qty: 1 }], tender: { cashCents: 250, cardCents: 0 } }, manager)).rejects.toThrow(/βάρδια του ταμείου έχει κλείσει/);
    expect(await counts()).toEqual(before);
  });
});

describe("αλλαγή τιμών ενώ το ταμείο είναι ανοιχτό", () => {
  it("το αποτύπωμα καταλόγου αλλάζει με την τιμή και η πώληση με παλιό σύνολο απορρίπτεται με σαφές μήνυμα", async () => {
    const { catalogVersion } = await import("@/server/services/till");
    const db = await getDb();
    const water = await productByName("Νερό 1L");
    const v1 = await catalogVersion(db);
    expect(await catalogVersion(db)).toBe(v1);

    const oldPrice = water.priceCents;
    await db.update(schema.products).set({ priceCents: oldPrice + 50 }).where(eq(schema.products.id, water.id));
    const v2 = await catalogVersion(db);
    expect(v2).not.toBe(v1);

    // Το ταμείο έβλεπε την παλιά τιμή: απορρίπτεται και λέει το σωστό σύνολο. Τίποτα δεν γράφεται.
    const sessionsBefore = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.tableSessions))[0].n;
    const stale = ref();
    await expect(
      quickSale({ cashSessionId: shift1, clientRef: stale, lines: [{ productId: water.id, qty: 1 }], tender: { cashCents: oldPrice, cardCents: 0 }, expectedTotalCents: oldPrice }, cashier),
    ).rejects.toThrow(/Άλλαξαν οι τιμές στο μενού/);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(schema.tableSessions))[0].n).toBe(sessionsBefore);

    // Με το νέο σύνολο περνά.
    const ok = await quickSale(
      { cashSessionId: shift1, clientRef: ref(), lines: [{ productId: water.id, qty: 1 }], tender: { cashCents: oldPrice + 50, cardCents: 0 }, expectedTotalCents: oldPrice + 50 },
      cashier,
    );
    expect(ok.totalCents).toBe(oldPrice + 50);

    // Επανάληψη πώλησης που ΕΧΕΙ ήδη καταχωρηθεί: επιστρέφει την ίδια, ακόμη κι αν στο μεταξύ άλλαξε η τιμή.
    const key = ref();
    const first = await quickSale({ cashSessionId: shift1, clientRef: key, lines: [{ productId: water.id, qty: 2 }], tender: { cashCents: 2 * (oldPrice + 50), cardCents: 0 }, expectedTotalCents: 2 * (oldPrice + 50) }, cashier);
    await db.update(schema.products).set({ priceCents: oldPrice }).where(eq(schema.products.id, water.id));
    const again = await quickSale({ cashSessionId: shift1, clientRef: key, lines: [{ productId: water.id, qty: 2 }], tender: { cashCents: 2 * (oldPrice + 50), cardCents: 0 }, expectedTotalCents: 2 * (oldPrice + 50) }, cashier);
    expect(again).toMatchObject({ sessionId: first.sessionId, duplicate: true });
  });
});
