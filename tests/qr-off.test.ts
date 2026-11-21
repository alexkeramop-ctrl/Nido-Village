import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, areaByName, stationByName } from "./helpers";
import { listRegisters, openRegisterShift, shiftSetupOptions, shiftSummary, updateShiftSetup } from "@/server/services/registers";
import { quickSale, type TillEmployee } from "@/server/services/till";
import { placeQrOrder, qrAreasStatus } from "@/server/services/public-order";
import { qrOrderingEnabled } from "@/server/features";

let cashier: TillEmployee;

afterAll(() => vi.unstubAllEnvs());

beforeAll(async () => {
  // Η προεπιλογή του καταστήματος: χωρίς NIDO_QR_ORDERING (μέχρι να συνδεθεί online πληρωμή).
  vi.stubEnv("NIDO_QR_ORDERING", undefined);
  await seeded();
  const c = await employeeByName("Νίκος");
  cashier = { id: c.id, name: c.name, role: c.role };
});

describe("παραγγελίες QR κλειστές (μέχρι την online πληρωμή)", () => {
  it("είναι κλειστές από προεπιλογή και ο server αρνείται κάθε παραγγελία, για κάθε χώρο", async () => {
    expect(qrOrderingEnabled()).toBe(false);
    const db = await getDb();
    const before = (await db.select().from(schema.tableSessions)).length;
    const cola = await productByName("Coca-Cola 330ml");
    for (const areaId of [(await areaByName("Κέντρο")).id, (await areaByName("Παιδική")).id, null]) {
      await expect(placeQrOrder({ areaId, customerName: "Κώστας", lines: [{ productId: cola.id, qty: 1 }] })).rejects.toThrow(/δεν είναι διαθέσιμες.*ταμείο/);
    }
    expect((await db.select().from(schema.tableSessions)).length).toBe(before);
  });

  it("το ταμείο διαλέγει μόνο μπαρ: οι χώροι QR αγνοούνται και κανένας χώρος δεν ανοίγει", async () => {
    const [r1] = await listRegisters();
    const kentro = (await areaByName("Κέντρο")).id;
    const barPaidiki = (await stationByName("Μπαρ Παιδική")).id;
    const opts = await shiftSetupOptions(r1.id);
    expect(opts.areas).toEqual([]);
    expect(opts.current.qrAreaIds).toEqual([]);
    expect(opts.bars.map((b) => b.name)).toEqual(["Μπαρ Κέντρο", "Μπαρ Παιδική"]);

    const shift = await openRegisterShift(r1.id, 0, cashier.id, { barStationId: barPaidiki, qrAreaIds: [kentro] });
    expect((await shiftSummary(shift.id)).qrAreas).toEqual([]);
    await updateShiftSetup(shift.id, { barStationId: barPaidiki, qrAreaIds: [kentro] }, cashier.id);
    expect((await shiftSummary(shift.id)).qrAreas).toEqual([]);
    expect((await qrAreasStatus()).every((a) => !a.open)).toBe(true);

    // Το μπαρ της βάρδιας ισχύει κανονικά για τις πωλήσεις του ταμείου.
    const cola = await productByName("Coca-Cola 330ml");
    const sale = await quickSale({ cashSessionId: shift.id, clientRef: "qr-off-sale-1", lines: [{ productId: cola.id, qty: 1 }], tender: { cashCents: 250, cardCents: 0 } }, cashier);
    const db = await getDb();
    const items = await db.query.orderItems.findMany({ where: eq(schema.orderItems.sessionId, sale.sessionId), with: { printStation: true } });
    expect(items.map((i) => i.printStation?.name)).toEqual(["Μπαρ Παιδική"]);
  });
});
