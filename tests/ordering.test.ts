import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName, ingredientByName, modifierByName, tableByName } from "./helpers";
import { openSession, sendRound, voidItem, getKdsTickets, bumpOrder, cancelSession } from "@/server/services/ordering";
import { getSessionDetail, addPayment, applyDiscount, printBill, listSessionsForCashier } from "@/server/services/billing";
import { getFloor } from "@/server/services/floor";
import { drainQueue } from "@/server/printing/queue";
import { num } from "@/server/money";

let waiter: { id: number };
let cashier: { id: number };

beforeAll(async () => {
  await seeded();
  waiter = await employeeByName("Μαρία");
  cashier = await employeeByName("Νίκος");
});

describe("order flow", () => {
  it("opens a table, sends a round, prints to the right stations and deducts stock", async () => {
    const db = await getDb();
    const table = await tableByName("Α3");
    const brizola = await productByName("Μπριζόλα χοιρινή");
    const fix = await productByName("Μπύρα Fix 500ml");
    const medium = await modifierByName("Μέτριο");
    const extraPot = await modifierByName("Extra πατάτες");
    const porkBefore = num((await ingredientByName("Χοιρινή μπριζόλα")).stockQty);
    const potBefore = num((await ingredientByName("Πατάτες")).stockQty);
    const fixBefore = num((await ingredientByName("Μπύρα Fix 500ml")).stockQty);

    const session = await openSession({ tableId: table.id, covers: 2 }, waiter.id);
    expect(session.status).toBe("open");
    // reopening same table returns same session
    const again = await openSession({ tableId: table.id }, waiter.id);
    expect(again.id).toBe(session.id);

    const order = await sendRound(
      session.id,
      [
        { productId: brizola.id, qty: 2, course: 2, modifierIds: [medium.id, extraPot.id], notes: "χωρίς αλάτι" },
        { productId: fix.id, qty: 3, course: 1 },
      ],
      waiter.id,
    );
    expect(order.roundNo).toBe(1);

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.items).toHaveLength(2);
    const b = detail.items.find((i) => i.productId === brizola.id)!;
    expect(b.modifiers.map((m) => m.nameSnapshot).sort()).toEqual(["Extra πατάτες", "Μέτριο"]);
    // 2 x (12.00 + 3.00) + 3 x 5.00 = 45.00
    expect(detail.totals.subtotalCents).toBe(4500);
    expect(detail.totals.vat.map((v) => v.ratePct).sort()).toEqual([13, 24]);

    // print jobs: one for kitchen, one for bar
    const jobs = await db.query.printJobs.findMany({ with: { station: true } });
    expect(jobs.map((j) => j.station.name).sort()).toEqual(["Κουζίνα", "Μπαρ"]);
    const kitchenJob = jobs.find((j) => j.station.name === "Κουζίνα")!;
    expect(kitchenJob.renderedText).toContain("2 X ΜΠΡΙΖΟΛΑ ΧΟΙΡΙΝΗ");
    expect(kitchenJob.renderedText).toContain("+ Extra πατάτες");
    expect(kitchenJob.renderedText).not.toContain("FIX");
    const barJob = jobs.find((j) => j.station.name === "Μπαρ")!;
    expect(barJob.renderedText).toContain("3 X ΜΠΥΡΑ FIX 500ML");

    // stock: pork 2*350, potatoes 2*(150+200 extra), fix 3
    expect(num((await ingredientByName("Χοιρινή μπριζόλα")).stockQty)).toBeCloseTo(porkBefore - 700, 3);
    expect(num((await ingredientByName("Πατάτες")).stockQty)).toBeCloseTo(potBefore - 700, 3);
    expect(num((await ingredientByName("Μπύρα Fix 500ml")).stockQty)).toBeCloseTo(fixBefore - 3, 3);

    // fiscal order slip recorded as not_required (no provider yet)
    const fd = await db.query.fiscalDocuments.findMany({ where: eq(schema.fiscalDocuments.sessionId, session.id) });
    expect(fd).toHaveLength(1);
    expect(fd[0].kind).toBe("order_slip_8_6");
    expect(fd[0].status).toBe("not_required");

    // floor shows the open table with totals
    const floor = await getFloor();
    const t = floor.areas.flatMap((a) => a.tables).find((x) => x.id === table.id)!;
    expect(t.session?.totalCents).toBe(4500);
    expect(t.session?.itemCount).toBe(5);

    // queue worker prints console jobs
    await drainQueue();
    const done = await db.query.printJobs.findMany();
    expect(done.every((j) => j.status === "done")).toBe(true);
  });

  it("KDS lists tickets per station and bump marks ready", async () => {
    const db = await getDb();
    const kitchen = (await db.query.printStations.findFirst({ where: eq(schema.printStations.name, "Κουζίνα") }))!;
    const tickets = await getKdsTickets(kitchen.id);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].items.map((i) => i.name)).toEqual(["Μπριζόλα χοιρινή"]);
    const all = await getKdsTickets();
    expect(all[0].items).toHaveLength(2);
    await bumpOrder(tickets[0].orderId, kitchen.id);
    expect(await getKdsTickets(kitchen.id)).toHaveLength(0);
    const bar = (await db.query.printStations.findFirst({ where: eq(schema.printStations.name, "Μπαρ") }))!;
    expect(await getKdsTickets(bar.id)).toHaveLength(1);
  });

  it("voids an item, restores stock, prints void ticket and audits", async () => {
    const db = await getDb();
    const table = await tableByName("Α3");
    const s = (await db.query.tableSessions.findFirst({ where: eq(schema.tableSessions.tableId, table.id) }))!;
    const detail = (await getSessionDetail(s.id))!;
    const beer = detail.items.find((i) => i.nameSnapshot.startsWith("Μπύρα"))!;
    const fixBefore = num((await ingredientByName("Μπύρα Fix 500ml")).stockQty);
    await expect(voidItem(beer.id, "", waiter.id)).rejects.toThrow();
    await voidItem(beer.id, "Λάθος παραγγελία", waiter.id);
    expect(num((await ingredientByName("Μπύρα Fix 500ml")).stockQty)).toBeCloseTo(fixBefore + 3, 3);
    const after = (await getSessionDetail(s.id))!;
    expect(after.items.find((i) => i.id === beer.id)!.status).toBe("voided");
    expect(after.totals.subtotalCents).toBe(3000);
    const voidJobs = await db.query.printJobs.findMany({ where: eq(schema.printJobs.kind, "void_ticket") });
    expect(voidJobs).toHaveLength(1);
    expect(voidJobs[0].renderedText).toContain("ΑΚΥΡΩΣΗ");
    const audit = await db.query.auditLog.findMany({ where: eq(schema.auditLog.action, "void_item") });
    expect(audit).toHaveLength(1);
    await expect(voidItem(beer.id, "ξανά", waiter.id)).rejects.toThrow(/ήδη/);
  });

  it("applies discount, prints bill, takes split payments and closes with fiscal record", async () => {
    const db = await getDb();
    const table = await tableByName("Α3");
    const s = (await db.query.tableSessions.findFirst({ where: eq(schema.tableSessions.tableId, table.id) }))!;
    await expect(applyDiscount(s.id, 500, "", cashier.id)).rejects.toThrow();
    await applyDiscount(s.id, 500, "Φίλος", cashier.id);
    await printBill(s.id, cashier.id);
    let d = (await getSessionDetail(s.id))!;
    expect(d.status).toBe("billed");
    expect(d.totals.totalCents).toBe(2500);
    const billJobs = await db.query.printJobs.findMany({ where: eq(schema.printJobs.kind, "bill") });
    expect(billJobs).toHaveLength(1);
    expect(billJobs[0].renderedText).toContain("25,00 €");

    const list = await listSessionsForCashier();
    expect(list.find((x) => x.id === s.id)?.totals.dueCents).toBe(2500);

    await expect(addPayment(s.id, { method: "card", amountCents: 9999 }, cashier.id)).rejects.toThrow(/υπερβαίνει/);
    const p1 = await addPayment(s.id, { method: "card", amountCents: 1000 }, cashier.id);
    expect(p1.closed).toBe(false);
    const p2 = await addPayment(s.id, { method: "cash", amountCents: 1500, tenderedCents: 2000 }, cashier.id);
    expect(p2.closed).toBe(true);
    expect(p2.changeCents).toBe(500);

    d = (await getSessionDetail(s.id))!;
    expect(d.status).toBe("closed");
    expect(d.totals.dueCents).toBe(0);
    const fd = await db.query.fiscalDocuments.findMany({ where: eq(schema.fiscalDocuments.kind, "receipt_11_1") });
    expect(fd).toHaveLength(1);
    expect(fd[0].status).toBe("not_required");
    // no receipt printed without provider
    const receiptJobs = await db.query.printJobs.findMany({ where: eq(schema.printJobs.kind, "receipt") });
    expect(receiptJobs).toHaveLength(0);

    // table is free again
    const floor = await getFloor();
    expect(floor.areas.flatMap((a) => a.tables).find((x) => x.id === table.id)!.session).toBeNull();
    await expect(sendRound(s.id, [{ productId: 1, qty: 1 }], waiter.id)).rejects.toThrow(/κλείσει/);
  });

  it("takeaway session requires a label and can be cancelled when empty", async () => {
    await expect(openSession({ orderType: "takeaway" }, waiter.id)).rejects.toThrow();
    const s = await openSession({ orderType: "takeaway", label: "Κώστας" }, waiter.id);
    const floor = await getFloor();
    expect(floor.takeaway.map((t) => t.label)).toContain("Κώστας");
    await cancelSession(s.id, "Δεν ήρθε", waiter.id);
    const d = (await getSessionDetail(s.id))!;
    expect(d.status).toBe("cancelled");
  });

  it("rejects unavailable products", async () => {
    const db = await getDb();
    const table = await tableByName("Κ1");
    const s = await openSession({ tableId: table.id }, waiter.id);
    const p = await productByName("Μουσακάς");
    await db.update(schema.products).set({ available: false }).where(eq(schema.products.id, p.id));
    await expect(sendRound(s.id, [{ productId: p.id, qty: 1 }], waiter.id)).rejects.toThrow(/εξαντληθεί/);
  });
});
