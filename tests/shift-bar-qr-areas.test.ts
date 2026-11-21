import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, areaByName, stationByName } from "./helpers";
import { closeRegisterShift, listRegisters, openRegisterShift, qrAreaOwners, shiftSetupOptions, shiftSummary, updateShiftSetup } from "@/server/services/registers";
import { listPendingForTill, quickSale, type TillEmployee } from "@/server/services/till";
import { placeQrOrder, qrAreasStatus } from "@/server/services/public-order";

/** Σε ποιους σταθμούς (κουζίνα/μπαρ) πήγαν τα είδη μιας συνεδρίας: [είδος, σταθμός]. */
async function stationsOf(sessionId: number) {
  const db = await getDb();
  const items = await db.query.orderItems.findMany({ where: eq(schema.orderItems.sessionId, sessionId), with: { printStation: true } });
  return items.map((i) => [i.nameSnapshot, i.printStation?.name ?? null]).sort();
}

let cashier: TillEmployee;
let t1: number;
let t2: number;
let kentro: number;
let paidiki: number;
let barKentro: number;
let barPaidiki: number;
let kitchen: number;
let cola: number;
let burger: number;

// Οι παραγγελίες QR είναι κλειστές από προεπιλογή (src/server/features.ts): εδώ ελέγχεται η λειτουργία τους.
afterAll(() => vi.unstubAllEnvs());

beforeAll(async () => {
  vi.stubEnv("NIDO_QR_ORDERING", "1");
  await seeded();
  const c = await employeeByName("Νίκος");
  cashier = { id: c.id, name: c.name, role: c.role };
  const [r1, r2] = await listRegisters();
  t1 = r1.id;
  t2 = r2.id;
  kentro = (await areaByName("Κέντρο")).id;
  paidiki = (await areaByName("Παιδική")).id;
  barKentro = (await stationByName("Μπαρ Κέντρο")).id;
  barPaidiki = (await stationByName("Μπαρ Παιδική")).id;
  kitchen = (await stationByName("Κουζίνα")).id;
  cola = (await productByName("Coca-Cola 330ml")).id;
  burger = (await productByName("Classic Burger")).id;
});

describe("μπαρ και χώροι QR ανά βάρδια ταμείου", () => {
  let shift1: number;
  let shift2: number;
  let orphan: { sessionId: number };

  it("ελέγχει τις επιλογές στο άνοιγμα: μπαρ υποχρεωτικό, μόνο μπαρ, μόνο ενεργοί χώροι", async () => {
    await expect(openRegisterShift(t1, 0, cashier.id, { barStationId: null, qrAreaIds: [] })).rejects.toThrow(/Διάλεξε σε ποιο μπαρ/);
    await expect(openRegisterShift(t1, 0, cashier.id, { barStationId: kitchen, qrAreaIds: [] })).rejects.toThrow(/μπαρ δεν βρέθηκε/);
    await expect(openRegisterShift(t1, 0, cashier.id, { barStationId: barKentro, qrAreaIds: [999999] })).rejects.toThrow(/χώρος δεν βρέθηκε/);
    const opts = await shiftSetupOptions(t1);
    expect(opts.bars.map((b) => b.name)).toEqual(["Μπαρ Κέντρο", "Μπαρ Παιδική"]);
    expect(opts.areas.map((a) => [a.name, a.takenBy])).toEqual([
      ["Κέντρο", null],
      ["Παιδική", null],
    ]);
    // Χωρίς προηγούμενη βάρδια και με 2 μπαρ: καμία πρόταση, ο ταμίας διαλέγει.
    expect(opts.current).toEqual({ barStationId: null, qrAreaIds: [] });
    // Κανένα ταμείο ανοιχτό: όλοι οι χώροι κλειστοί για QR.
    expect((await qrAreasStatus()).map((a) => a.open)).toEqual([false, false]);
    await expect(placeQrOrder({ areaId: kentro, customerName: "Κώστας", lines: [{ productId: cola, qty: 1 }] })).rejects.toThrow(/δεν είναι ανοιχτές.*Παράγγειλε στο ταμείο/);
  });

  it("ένας χώρος ανήκει σε ένα ταμείο: το Ταμείο 2 παίρνει την Παιδική από το Ταμείο 1", async () => {
    shift1 = (await openRegisterShift(t1, 5000, cashier.id, { barStationId: barKentro, qrAreaIds: [paidiki, kentro, kentro] })).id;
    expect((await shiftSummary(shift1)).qrAreas.map((a) => a.name)).toEqual(["Κέντρο", "Παιδική"]);
    expect((await shiftSetupOptions(t2)).areas.map((a) => [a.name, a.takenBy])).toEqual([
      ["Κέντρο", "Ταμείο 1"],
      ["Παιδική", "Ταμείο 1"],
    ]);
    shift2 = (await openRegisterShift(t2, 2000, cashier.id, { barStationId: barPaidiki, qrAreaIds: [paidiki] })).id;
    const s1 = await shiftSummary(shift1);
    const s2 = await shiftSummary(shift2);
    expect([s1.barName, s1.qrAreas.map((a) => a.name)]).toEqual(["Μπαρ Κέντρο", ["Κέντρο"]]);
    expect([s2.barName, s2.qrAreas.map((a) => a.name)]).toEqual(["Μπαρ Παιδική", ["Παιδική"]]);
    const owners = await qrAreaOwners(await getDb());
    expect([owners.get(kentro)?.registerName, owners.get(paidiki)?.registerName]).toEqual(["Ταμείο 1", "Ταμείο 2"]);
    expect((await qrAreasStatus()).map((a) => [a.name, a.open])).toEqual([
      ["Κέντρο", true],
      ["Παιδική", true],
    ]);
  });

  it("η γρήγορη πώληση στέλνει τα ροφήματα στο μπαρ του ταμείου και τα φαγητά στην κουζίνα", async () => {
    const tender = { cashCents: 1100, cardCents: 0 };
    const a = await quickSale({ cashSessionId: shift2, clientRef: "bar-test-sale-t2", lines: [{ productId: cola, qty: 1 }, { productId: burger, qty: 1 }], tender }, cashier);
    expect(await stationsOf(a.sessionId)).toEqual([
      ["Classic Burger", "Κουζίνα"],
      ["Coca-Cola 330ml", "Μπαρ Παιδική"],
    ]);
    const b = await quickSale({ cashSessionId: shift1, clientRef: "bar-test-sale-t1", lines: [{ productId: cola, qty: 1 }], tender: { cashCents: 250, cardCents: 0 } }, cashier);
    expect(await stationsOf(b.sessionId)).toEqual([["Coca-Cola 330ml", "Μπαρ Κέντρο"]]);
  });

  it("η παραγγελία QR φαίνεται μόνο στο ταμείο του χώρου της και τα ροφήματά της βγαίνουν στο μπαρ του", async () => {
    await expect(placeQrOrder({ customerName: "Χωρίς χώρο", lines: [{ productId: cola, qty: 1 }] })).rejects.toThrow(/Διάλεξε πού κάθεσαι/);
    const p = await placeQrOrder({ areaId: paidiki, customerName: "Μαρία", lines: [{ productId: cola, qty: 2 }, { productId: burger, qty: 1 }] });
    const k = await placeQrOrder({ areaId: kentro, customerName: "Νίκη", lines: [{ productId: cola, qty: 1 }] });
    expect(await stationsOf(p.sessionId)).toEqual([
      ["Classic Burger", "Κουζίνα"],
      ["Coca-Cola 330ml", "Μπαρ Παιδική"],
    ]);
    expect(await stationsOf(k.sessionId)).toEqual([["Coca-Cola 330ml", "Μπαρ Κέντρο"]]);
    const at1 = await listPendingForTill(t1);
    const at2 = await listPendingForTill(t2);
    expect(at1.map((o) => [o.customerName, o.areaName])).toEqual([["Νίκη", "Κέντρο"]]);
    expect(at2.map((o) => [o.customerName, o.areaName])).toEqual([["Μαρία", "Παιδική"]]);
    // Χωρίς ταμείο (π.χ. οθόνες διαχείρισης): όλες.
    expect((await listPendingForTill()).length).toBe(2);
    orphan = p;
  });

  it("όταν κλείνει το ταμείο ενός χώρου: ο χώρος κλείνει για QR, οι απλήρωτες παραγγελίες του φαίνονται στα άλλα ταμεία", async () => {
    await closeRegisterShift(shift2, 2000 + 1100, cashier.id);
    expect((await qrAreasStatus()).map((a) => [a.name, a.open])).toEqual([
      ["Κέντρο", true],
      ["Παιδική", false],
    ]);
    await expect(placeQrOrder({ areaId: paidiki, customerName: "Άννα", lines: [{ productId: cola, qty: 1 }] })).rejects.toThrow(/«Παιδική» δεν είναι ανοιχτές/);
    expect((await listPendingForTill(t1)).map((o) => o.sessionId).sort()).toContain(orphan.sessionId);
  });

  it("το Ταμείο 1 αναλαμβάνει την Παιδική μέσα στη βάρδια: οι νέες QR της πάνε στο δικό του μπαρ", async () => {
    await expect(updateShiftSetup(shift2, { barStationId: barPaidiki, qrAreaIds: [paidiki] }, cashier.id)).rejects.toThrow(/έχει κλείσει/);
    const moved = await updateShiftSetup(shift1, { barStationId: barKentro, qrAreaIds: [kentro, paidiki] }, cashier.id);
    expect(moved).toEqual([]);
    const q = await placeQrOrder({ areaId: paidiki, customerName: "Άννα", lines: [{ productId: cola, qty: 1 }] });
    expect(await stationsOf(q.sessionId)).toEqual([["Coca-Cola 330ml", "Μπαρ Κέντρο"]]);
    expect((await listPendingForTill(t1)).map((o) => o.customerName).sort()).toEqual(["Άννα", "Μαρία", "Νίκη"]);
  });

  it("στο επόμενο άνοιγμα προτείνει το μπαρ της προηγούμενης βάρδιας, χωρίς χώρους που έχει ήδη άλλο ταμείο", async () => {
    const opts = await shiftSetupOptions(t2);
    expect(opts.current).toEqual({ barStationId: barPaidiki, qrAreaIds: [] });
    expect(opts.areas.find((a) => a.id === paidiki)?.takenBy).toBe("Ταμείο 1");
  });
});
