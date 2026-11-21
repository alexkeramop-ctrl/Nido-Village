import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { listRegisters, openRegisterShift, setShiftQr, upsertRegister } from "@/server/services/registers";
import { listPendingForTill, payOrderAtTill, qrRouting, quickSale, tillSnapshot, type TillEmployee } from "@/server/services/till";
import { getPublicOrder } from "@/server/services/public-order";
import { openSession } from "@/server/services/ordering";
import { getFloor } from "@/server/services/floor";
import { placeQrOrder } from "@/server/services/public-order";

let cashier: TillEmployee;
let reg1: number;
let reg2: number;
let shift1: number;
let shift2: number;
let kentro: number;
let paidiki: number;
let barKentro: number;
let barPaidiki: number;

async function stationOfItems(sessionId: number) {
  const db = await getDb();
  const items = await db.query.orderItems.findMany({ where: eq(schema.orderItems.sessionId, sessionId) });
  return items.map((i) => i.printStationId);
}

beforeAll(async () => {
  const db = await seeded();
  const c = await employeeByName("Νίκος");
  cashier = { id: c.id, name: c.name, role: c.role };
  const areas = await db.query.areas.findMany();
  kentro = areas.find((a) => a.name === "Κέντρο")!.id;
  paidiki = areas.find((a) => a.name === "Παιδική")!.id;
  barKentro = areas.find((a) => a.id === kentro)!.barStationId!;
  barPaidiki = areas.find((a) => a.id === paidiki)!.barStationId!;
  const [r1, r2] = await listRegisters();
  reg1 = r1.id;
  reg2 = r2.id;
});

describe("qrRouting (καθαρή συνάρτηση)", () => {
  const shifts = [
    { cashSessionId: 1, qrAreaIds: [10], qrTakeaway: true },
    { cashSessionId: 2, qrAreaIds: [20], qrTakeaway: false },
  ];
  it("στέλνει κάθε χώρο στο ταμείο που τον ανέλαβε", () => {
    expect(qrRouting(10, shifts)).toEqual({ cashSessionIds: [1], unassigned: false });
    expect(qrRouting(20, shifts)).toEqual({ cashSessionIds: [2], unassigned: false });
    expect(qrRouting(null, shifts)).toEqual({ cashSessionIds: [1], unassigned: false });
  });
  it("χώρος χωρίς ταμείο: φαίνεται σε όλα για να μη χαθεί", () => {
    expect(qrRouting(30, shifts)).toEqual({ cashSessionIds: [1, 2], unassigned: true });
    expect(qrRouting(null, [{ cashSessionId: 2, qrAreaIds: [20], qrTakeaway: false }])).toEqual({ cashSessionIds: [2], unassigned: true });
  });
  it("παλιές βάρδιες (null) δέχονται όλους τους χώρους· δύο ταμεία στον ίδιο χώρο το βλέπουν και τα δύο", () => {
    expect(qrRouting(30, [{ cashSessionId: 3, qrAreaIds: null, qrTakeaway: true }])).toEqual({ cashSessionIds: [3], unassigned: false });
    expect(qrRouting(10, [shifts[0], { cashSessionId: 4, qrAreaIds: [10, 20], qrTakeaway: false }])).toEqual({ cashSessionIds: [1, 4], unassigned: false });
  });
});

describe("2 ταμεία · 2 μπαρ · 1 κουζίνα", () => {
  it("τα demo ταμεία εξυπηρετούν Κέντρο και Παιδική και η βάρδια προτείνει τον χώρο του ταμείου", async () => {
    const regs = await listRegisters();
    expect(regs.slice(0, 2).map((r) => [r.name, r.areaName])).toEqual([
      ["Ταμείο 1", "Κέντρο"],
      ["Ταμείο 2", "Παιδική"],
    ]);
    // Ταμείο 1 χωρίς επιλογή: ο χώρος του + πακέτα. Ταμείο 2: μόνο Παιδική, χωρίς πακέτα.
    shift1 = (await openRegisterShift(reg1, 0, cashier.id)).id;
    shift2 = (await openRegisterShift(reg2, 0, cashier.id, { areaIds: [paidiki], takeaway: false })).id;
    const db = await getDb();
    const s1 = await db.query.cashSessions.findFirst({ where: eq(schema.cashSessions.id, shift1) });
    expect(s1).toMatchObject({ qrAreaIds: [kentro], qrTakeaway: true });
    await expect(openRegisterShift(reg1, 0, cashier.id)).rejects.toThrow(/ήδη ανοιχτή/);
  });

  it("γρήγορη πώληση: τα ροφήματα στο μπαρ του χώρου του ταμείου, το φαγητό στην κουζίνα", async () => {
    const cola = await productByName("Coca-Cola 330ml");
    const burger = await productByName("Classic Burger");
    const sale = (shift: number, ref: string) =>
      quickSale({ cashSessionId: shift, clientRef: ref, lines: [{ productId: cola.id, qty: 1 }, { productId: burger.id, qty: 1 }], tender: { cashCents: 0, cardCents: cola.priceCents + burger.priceCents } }, cashier);
    const a = await sale(shift1, "qr-areas-sale-1");
    const b = await sale(shift2, "qr-areas-sale-2");
    const [colaA, burgerA] = await stationOfItems(a.sessionId);
    const [colaB, burgerB] = await stationOfItems(b.sessionId);
    expect(colaA).toBe(barKentro);
    expect(colaB).toBe(barPaidiki);
    expect(burgerA).toBe(burgerB);
    expect(burgerA).not.toBe(barKentro);
    expect(burgerA).not.toBe(barPaidiki);
  });

  it("QR από τραπέζι της Παιδικής: μπαρ Παιδικής, μόνο στο Ταμείο 2, ξεχωριστός λογαριασμός από το τραπέζι", async () => {
    const cola = await productByName("Coca-Cola 330ml");
    const p3 = await tableByName("Π3");
    const r = await placeQrOrder({ tableId: p3.id, customerName: "Μαρία", lines: [{ productId: cola.id, qty: 2 }] });
    expect(await stationOfItems(r.sessionId)).toEqual([barPaidiki]);

    const at1 = await listPendingForTill(reg1);
    const at2 = await listPendingForTill(reg2);
    expect(at1.find((o) => o.sessionId === r.sessionId)).toBeUndefined();
    expect(at2.find((o) => o.sessionId === r.sessionId)).toMatchObject({ qr: true, areaName: "Παιδική", unassigned: false, name: `#${r.code} Μαρία · Π3` });

    // Δεύτερος πελάτης στο ίδιο τραπέζι: δικός του λογαριασμός.
    const r2 = await placeQrOrder({ tableId: p3.id, customerName: "Γιάννης", lines: [{ productId: cola.id, qty: 1 }] });
    expect(r2.sessionId).not.toBe(r.sessionId);
    // Το προσωπικό που ανοίγει το τραπέζι δεν «πέφτει» πάνω σε λογαριασμό πελάτη QR.
    const staff = await openSession({ tableId: p3.id }, cashier.id);
    expect([r.sessionId, r2.sessionId]).not.toContain(staff.id);
    const floor = await getFloor();
    const p3Floor = floor.areas.flatMap((a) => a.tables).find((t) => t.id === p3.id)!;
    expect(p3Floor.session?.id).toBe(staff.id);
    expect(floor.takeaway.find((t) => t.id === r.sessionId)?.label).toBe(`#${r.code} Μαρία · Π3`);

    // Πληρωμή στο Ταμείο 2 με βομβητή: κλείνει μόνο ο λογαριασμός της Μαρίας, ο πελάτης βλέπει «πληρώθηκε».
    const due = (await listPendingForTill(reg2)).find((o) => o.sessionId === r.sessionId)!.dueCents;
    const paid = await payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift2, buzzerNo: 31, tender: { cashCents: due, cardCents: 0 } }, cashier);
    expect(paid).toMatchObject({ sessionId: r.sessionId, totalCents: due, buzzerNo: 31 });
    expect(await getPublicOrder(r.token)).toMatchObject({ paid: true, buzzerNo: 31 });
    const left = (await listPendingForTill(reg2)).map((o) => o.sessionId);
    expect(left).not.toContain(r.sessionId);
    expect(left).toContain(r2.sessionId);
  });

  it("πακέτο (QR χωρίς τραπέζι) μόνο στο ταμείο που δέχεται πακέτα· αλλαγή μέσα στη βάρδια", async () => {
    const cola = await productByName("Coca-Cola 330ml");
    const k5 = await tableByName("Κ5");
    const take = await placeQrOrder({ customerName: "Πακέτο", lines: [{ productId: cola.id, qty: 1 }] });
    const kOrder = await placeQrOrder({ tableId: k5.id, customerName: "Νίκη", lines: [{ productId: cola.id, qty: 1 }] });
    expect(await stationOfItems(kOrder.sessionId)).toEqual([barKentro]);
    let ids1 = (await listPendingForTill(reg1)).map((o) => o.sessionId);
    let ids2 = (await listPendingForTill(reg2)).map((o) => o.sessionId);
    expect(ids1).toEqual(expect.arrayContaining([take.sessionId, kOrder.sessionId]));
    expect(ids2).not.toContain(take.sessionId);
    expect(ids2).not.toContain(kOrder.sessionId);

    // Μέρα με πολύ κόσμο: το Ταμείο 2 παίρνει και το Κέντρο. Το Ταμείο 1 κρατά μόνο τα πακέτα.
    await setShiftQr(shift2, { areaIds: [kentro, paidiki], takeaway: false }, cashier.id);
    await setShiftQr(shift1, { areaIds: [], takeaway: true }, cashier.id);
    ids1 = (await listPendingForTill(reg1)).map((o) => o.sessionId);
    ids2 = (await listPendingForTill(reg2)).map((o) => o.sessionId);
    expect(ids1).toContain(take.sessionId);
    expect(ids1).not.toContain(kOrder.sessionId);
    expect(ids2).toContain(kOrder.sessionId);

    // Κανείς δεν δέχεται Κέντρο: φαίνεται και στα δύο ως «Χωρίς ταμείο».
    await setShiftQr(shift2, { areaIds: [paidiki], takeaway: false }, cashier.id);
    const o1 = (await listPendingForTill(reg1)).find((o) => o.sessionId === kOrder.sessionId);
    const o2 = (await listPendingForTill(reg2)).find((o) => o.sessionId === kOrder.sessionId);
    expect(o1?.unassigned).toBe(true);
    expect(o2?.unassigned).toBe(true);

    // Η εικόνα του ταμείου ξέρει τι δέχονται τα άλλα ταμεία.
    const snap = await tillSnapshot(reg1);
    expect(snap.shift).toMatchObject({ qrAreaIds: [], qrTakeaway: true });
    expect(snap.qrOthers).toEqual([{ registerName: "Ταμείο 2", qrAreaIds: [paidiki], qrTakeaway: false }]);
  });

  it("απορρίπτει άκυρα τραπέζια/χώρους και κρατά τον χώρο του ταμείου όταν δεν αλλάζει", async () => {
    const cola = await productByName("Coca-Cola 330ml");
    await expect(placeQrOrder({ tableId: 999999, customerName: "Χ", lines: [{ productId: cola.id, qty: 1 }] })).rejects.toThrow();
    await expect(placeQrOrder({ tableId: 999999, customerName: "Χρήστος", lines: [{ productId: cola.id, qty: 1 }] })).rejects.toThrow(/τραπέζι/);
    await expect(setShiftQr(shift1, { areaIds: [999999], takeaway: true }, cashier.id)).rejects.toThrow(/χώρος/);
    await upsertRegister({ id: reg2, name: "Ταμείο 2" }, cashier.id);
    expect((await listRegisters()).find((r) => r.id === reg2)?.areaId).toBe(paidiki);
    await expect(upsertRegister({ id: reg2, name: "Ταμείο 2", areaId: 999999 }, cashier.id)).rejects.toThrow();
  });
});
