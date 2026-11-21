import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, modifierByName } from "./helpers";
import { placeQrOrder, getPublicOrder, listPickupBoard, markPickedUp, getPublicMenu, getSessionIdForToken, QR_EMPLOYEE_NAME } from "@/server/services/public-order";
import { bumpOrder, getKdsTickets, sendRound } from "@/server/services/ordering";
import { addPayment } from "@/server/services/billing";
import { getFloor, saveTablePositions, saveFloorLayout, saveAreaPlan, autoLayoutArea, setAreaMap, listAreas } from "@/server/services/floor";
import { saveAsset, getAsset } from "@/server/services/assets";
import { loginWithPin } from "@/server/auth";
import { saveSettings } from "@/server/services/settings";

beforeAll(async () => {
  await seeded();
});

describe("QR takeaway ordering", () => {
  // Η ροή «τύπωμα αμέσως» (ρύθμιση qrPrintAfterPayment = false). Η προεπιλογή «μετά την πληρωμή»: tests/qr-hold.test.ts.
  beforeAll(async () => {
    await saveSettings({ qrOrdering: true, qrPrintAfterPayment: false });
  });

  it("places an order, tracks status to ready and pickup, then payment closes it", async () => {
    const db = await getDb();
    const menu = await getPublicMenu();
    expect(menu.length).toBeGreaterThan(3);
    const brizola = await productByName("Classic Burger");
    const medium = await modifierByName("Extra τυρί");
    await expect(placeQrOrder({ customerName: "K", lines: [{ productId: brizola.id, qty: 1 }] })).rejects.toThrow(/όνομ/);
    await expect(placeQrOrder({ customerName: "Κώστας", lines: [] })).rejects.toThrow(/άδειο/);
    await expect(placeQrOrder({ customerName: "Κώστας", customerPhone: "123", lines: [{ productId: brizola.id, qty: 1 }] })).rejects.toThrow(/τηλέφωνο/);

    const r = await placeQrOrder({
      customerName: "Κώστας",
      customerPhone: "69 1234 5678",
      notes: "Χωρίς πατάτες",
      lines: [{ productId: brizola.id, qty: 2, modifierIds: [medium.id] }],
    });
    expect(r.code).toBe("001");
    expect(r.token.length).toBeGreaterThan(20);
    expect(await getSessionIdForToken(r.token)).toBe(r.sessionId);

    let o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("received");
    expect(o.customerName).toBe("Κώστας");
    expect(o.items[0].modifiers).toEqual(["Extra τυρί"]);
    expect(o.totalCents).toBe(1900);
    expect(o.paid).toBe(false);

    // kitchen sees it as a takeaway ticket with the pickup code
    const tickets = await getKdsTickets();
    const t = tickets.find((x) => x.sessionId === r.sessionId)!;
    expect(t.orderType).toBe("takeaway");
    expect(t.tableName).toContain("#001");
    expect(t.waiter).toBe(QR_EMPLOYEE_NAME);
    const kitchenJob = await db.query.printJobs.findFirst({ where: eq(schema.printJobs.kind, "kitchen_ticket") });
    expect(kitchenJob?.renderedText).toContain("ΠΑΚΕΤΟ");

    const board1 = await listPickupBoard();
    expect(board1.map((b) => b.code)).toEqual(["001"]);

    await bumpOrder(t.orderId);
    o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("ready");
    expect(o.readyAt).not.toBeNull();
    expect((await listPickupBoard())[0].status).toBe("ready");

    await markPickedUp(r.sessionId);
    o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("picked_up");
    expect(await listPickupBoard()).toHaveLength(0);

    const cashier = await employeeByName("Νίκος");
    await addPayment(r.sessionId, { method: "card", amountCents: 1900 }, cashier.id);
    o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("done");
    expect(o.paid).toBe(true);

    // second order of the day gets the next code
    const r2 = await placeQrOrder({ customerName: "Ελένη", lines: [{ productId: brizola.id, qty: 1 }] });
    expect(r2.code).toBe("002");
    expect(await getPublicOrder("nope")).toBeNull();
  });

  it("a new round after ready resets readiness", async () => {
    const brizola = await productByName("Classic Burger");
    const r = await placeQrOrder({ customerName: "Γιάννης", lines: [{ productId: brizola.id, qty: 1 }] });
    const t = (await getKdsTickets()).find((x) => x.sessionId === r.sessionId)!;
    await bumpOrder(t.orderId);
    expect((await getPublicOrder(r.token))!.status).toBe("ready");
    const waiter = await employeeByName("Μαρία");
    await sendRound(r.sessionId, [{ productId: brizola.id, qty: 1 }], waiter.id);
    const o = (await getPublicOrder(r.token))!;
    expect(o.status).toBe("preparing");
    expect(o.readyAt).toBeNull();
  });

  it("the QR system employee cannot log in", async () => {
    const db = await getDb();
    const e = await db.query.employees.findFirst({ where: eq(schema.employees.name, QR_EMPLOYEE_NAME) });
    expect(e?.active).toBe(false);
    expect(await loginWithPin("0000")).toBeNull();
  });
});

describe("floor map", () => {
  it("seeds positions and a plain plan (no photo), saves positions and auto-layouts", async () => {
    const floor = await getFloor();
    const kentro = floor.areas.find((a) => a.name === "Κέντρο")!;
    expect(kentro.tables).toHaveLength(30);
    expect(kentro.tables.every((t) => t.posX !== null && t.posY !== null)).toBe(true);
    // Το demo δεν βάζει πια φωτογραφία: απλή κάτοψη με 3 δωμάτια και τα τραπέζια μέσα τους.
    expect(kentro.mapAssetId).toBeNull();
    expect(kentro.plan?.rooms.map((r) => r.name)).toEqual(["Σάλα", "Πέργκολα", "Βεράντα"]);
    for (const t of kentro.tables) {
      expect(kentro.plan!.rooms.some((r) => t.posX! > r.x && t.posX! < r.x + r.w && t.posY! > r.y && t.posY! < r.y + r.h)).toBe(true);
    }

    const t1 = kentro.tables[0];
    await saveTablePositions(kentro.id, [{ id: t1.id, posX: 1500, posY: -5, shape: "wide" }]);
    const after = (await getFloor()).areas.find((a) => a.name === "Κέντρο")!.tables.find((t) => t.id === t1.id)!;
    expect(after.posX).toBe(1000);
    expect(after.posY).toBe(0);
    expect(after.shape).toBe("wide");

    await saveTablePositions(kentro.id, kentro.tables.slice(0, 5).map((t) => ({ id: t.id, posX: null, posY: null })));
    const moved = await autoLayoutArea(kentro.id);
    expect(moved).toBe(5);
    expect((await getFloor()).areas.find((a) => a.name === "Κέντρο")!.tables.every((t) => t.posX !== null)).toBe(true);

    const a = await saveAsset({ mime: "image/png", bytes: Buffer.from("89504e470d0a1a0a", "hex"), width: 1, height: 1 });
    await setAreaMap(kentro.id, a.id);
    expect((await listAreas()).find((x) => x.id === kentro.id)?.mapAssetId).toBe(a.id);
    expect((await getAsset(a.id))?.mime).toBe("image/png");
    await expect(saveAsset({ mime: "text/html", bytes: Buffer.from("x") })).rejects.toThrow();
  });

  it("saves rooms and table positions together, sanitised", async () => {
    const kentro = (await getFloor()).areas.find((a) => a.name === "Κέντρο")!;
    const t1 = kentro.tables[0];
    const saved = await saveFloorLayout(kentro.id, [{ id: t1.id, posX: 123, posY: 456 }], {
      rooms: [
        { id: "a", name: "  Σάλα   μεγάλη ", x: -50, y: 20, w: 5000, h: 10, color: "javascript:alert(1)" },
        { id: "a", name: "", x: 900, y: 900, w: 300, h: 300, color: "sky" },
      ],
    });
    expect(saved.rooms).toHaveLength(2);
    const after = (await getFloor()).areas.find((a) => a.id === kentro.id)!;
    expect(after.plan).toEqual(saved);
    expect(after.plan!.rooms[0]).toMatchObject({ id: "a", name: "Σάλα μεγάλη", x: 0, y: 20, w: 1000, h: 100, color: "sand" });
    expect(after.plan!.rooms[1]).toMatchObject({ name: "Ζώνη", x: 700, y: 700, w: 300, h: 300, color: "sky" });
    expect(after.plan!.rooms[1].id).not.toBe("a");
    expect(after.tables.find((t) => t.id === t1.id)).toMatchObject({ posX: 123, posY: 456 });

    // Άκυρη κάτοψη: δεν αλλάζει τίποτα (ούτε οι θέσεις).
    await expect(saveFloorLayout(kentro.id, [{ id: t1.id, posX: 1, posY: 1 }], { rooms: "x" })).rejects.toThrow();
    await expect(saveFloorLayout(999999, [], { rooms: [] })).rejects.toThrow();
    expect((await getFloor()).areas.find((a) => a.id === kentro.id)!.tables.find((t) => t.id === t1.id)).toMatchObject({ posX: 123, posY: 456 });

    // Χωρίς δωμάτια γράφεται null.
    await saveAreaPlan(kentro.id, { rooms: [] });
    expect((await getFloor()).areas.find((a) => a.id === kentro.id)!.plan).toBeNull();
  });
});
