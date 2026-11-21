import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { saveSettings } from "@/server/services/settings";
import { listRegisters, openRegisterShift } from "@/server/services/registers";
import { listPendingForTill, payOrderAtTill, type TillEmployee } from "@/server/services/till";
import { getKdsTickets, voidItem } from "@/server/services/ordering";
import { addPayment } from "@/server/services/billing";
import { getPublicOrder, listPickupBoard, placeQrOrder } from "@/server/services/public-order";

let cashier: TillEmployee;
let shift: number;


beforeAll(async () => {
  await seeded();
  const c = await employeeByName("Νίκος");
  cashier = { id: c.id, name: c.name, role: c.role };
  const [r1] = await listRegisters();
  shift = (await openRegisterShift(r1.id, 0, cashier.id)).id;
});

describe("QR κλειστό: μόνο μενού", () => {
  it("η προεπιλογή απορρίπτει παραγγελία από το κινητό", async () => {
    const cola = await productByName("Coca-Cola 330ml");
    await expect(placeQrOrder({ customerName: "Κώστας", lines: [{ productId: cola.id, qty: 1 }] })).rejects.toThrow(/δεν είναι διαθέσιμες/);
  });
});

describe("τύπωμα μετά την πληρωμή (για όταν ανοίξουν οι παραγγελίες QR με online πληρωμή)", () => {
  beforeAll(async () => {
    await saveSettings({ qrOrdering: true, qrPrintAfterPayment: true });
  });

  it("κρατά την παραγγελία μέχρι την πληρωμή και μετά την τυπώνει με τον βομβητή", async () => {
    const db = await getDb();
    const burger = await productByName("Classic Burger");
    const cola = await productByName("Coca-Cola 330ml");
    const p3 = await tableByName("Π3");
    const jobsBefore = (await db.query.printJobs.findMany()).length;
    const r = await placeQrOrder({ tableId: p3.id, customerName: "Μαρία", lines: [{ productId: burger.id, qty: 1 }, { productId: cola.id, qty: 2 }] });

    // Πριν την πληρωμή: τίποτα στην κουζίνα/μπαρ, όχι στον πίνακα παραλαβών, ο πελάτης ξέρει ότι περιμένει πληρωμή.
    expect((await db.query.printJobs.findMany()).length).toBe(jobsBefore);
    expect((await getKdsTickets()).find((t) => t.sessionId === r.sessionId)).toBeUndefined();
    expect((await listPickupBoard()).find((b) => b.sessionId === r.sessionId)).toBeUndefined();
    expect(await getPublicOrder(r.token)).toMatchObject({ waitingPayment: true, paid: false });
    const pending = (await listPendingForTill()).find((o) => o.sessionId === r.sessionId)!;
    expect(pending).toMatchObject({ held: true, qr: true });

    // Ακύρωση είδους πριν την πληρωμή: δεν τυπώνεται δελτίο ακύρωσης (η κουζίνα δεν την είχε δει).
    const items = await db.query.orderItems.findMany({ where: eq(schema.orderItems.sessionId, r.sessionId) });
    const colaItem = items.find((i) => i.productId === cola.id)!;
    await voidItem(colaItem.id, "Δεν θέλει", cashier.id);
    expect((await db.query.printJobs.findMany()).length).toBe(jobsBefore);

    // Πληρωμή με βομβητή 9: τυπώνεται ολόκληρο δελτίο με τον βομβητή, χωρίς ξεχωριστό «δελτίο βομβητή».
    const due = (await listPendingForTill()).find((o) => o.sessionId === r.sessionId)!.dueCents;
    await payOrderAtTill({ sessionId: r.sessionId, cashSessionId: shift, buzzerNo: 9, tender: { cashCents: due, cardCents: 0 } }, cashier);
    const newJobs = (await db.query.printJobs.findMany()).slice(jobsBefore);
    expect(newJobs).toHaveLength(1);
    expect(newJobs[0].kind).toBe("kitchen_ticket");
    expect(newJobs[0].renderedText).toContain("ΒΟΜΒΗΤΗΣ 9");
    expect(newJobs[0].renderedText).toContain("CLASSIC BURGER");
    expect(newJobs[0].renderedText).not.toContain("COCA-COLA");
    // Το όνομα του πελάτη μία φορά (είναι ήδη στο «#001 Μαρία»).
    expect(newJobs[0].renderedText!.match(/Μαρία/g)).toHaveLength(1);

    const ticket = (await getKdsTickets()).find((t) => t.sessionId === r.sessionId)!;
    expect(ticket).toMatchObject({ buzzerNo: 9, paid: true });
    expect(ticket.items.map((i) => i.name)).toEqual(["Classic Burger"]);
    expect(await getPublicOrder(r.token)).toMatchObject({ waitingPayment: false, paid: true, buzzerNo: 9 });
    expect((await listPickupBoard()).find((b) => b.sessionId === r.sessionId)).toBeTruthy();
    const orders = await db.query.orders.findMany({ where: eq(schema.orders.sessionId, r.sessionId) });
    expect(orders.every((o) => !o.held)).toBe(true);
  });

  it("τα ροφήματα τραπεζιού πάνε στο μπαρ του χώρου του και η παλιά πληρωμή λογαριασμού απελευθερώνει επίσης", async () => {
    const db = await getDb();
    const cola = await productByName("Coca-Cola 330ml");
    const p5 = await tableByName("Π5");
    const area = await db.query.areas.findFirst({ where: eq(schema.areas.id, p5.areaId) });
    const jobsBefore = (await db.query.printJobs.findMany()).length;
    const r = await placeQrOrder({ tableId: p5.id, customerName: "Γιάννης", lines: [{ productId: cola.id, qty: 1 }] });
    expect((await db.query.printJobs.findMany()).length).toBe(jobsBefore);
    const due = (await listPendingForTill()).find((o) => o.sessionId === r.sessionId)!.dueCents;
    await addPayment(r.sessionId, { method: "card", amountCents: due }, cashier.id, { cashSessionId: shift });
    const newJobs = (await db.query.printJobs.findMany()).slice(jobsBefore).filter((j) => j.kind === "kitchen_ticket");
    expect(newJobs.map((j) => j.stationId)).toEqual([area!.barStationId]);
    const held = await db.query.orders.findMany({ where: inArray(schema.orders.sessionId, [r.sessionId]) });
    expect(held.every((o) => !o.held)).toBe(true);
  });
});
