import { beforeAll, describe, expect, it } from "vitest";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { deleteEmployee, listEmployees, revealPin, upsertEmployee } from "@/server/services/staff";
import { loginWithPin } from "@/server/auth";
import { openSession, sendRound } from "@/server/services/ordering";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

let admin: { id: number };
beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});

describe("staff PINs and deletion", () => {
  it("reveals stored PINs to the admin and audits it", async () => {
    const maria = await employeeByName("Μαρία");
    expect(await revealPin(maria.id, admin.id)).toBe("1111");
    const created = await upsertEmployee({ name: "Νέος", role: "waiter", pin: "5678" });
    expect(await revealPin(created.id, admin.id)).toBe("5678");
    await upsertEmployee({ id: created.id, name: "Νέος", role: "waiter", pin: "9999" });
    expect(await revealPin(created.id, admin.id)).toBe("9999");
    expect(await loginWithPin("9999")).toMatchObject({ name: "Νέος" });
    const db = await getDb();
    const logs = await db.query.auditLog.findMany({ where: eq(schema.auditLog.action, "pin_reveal") });
    expect(logs.length).toBe(3);
    const list = await listEmployees(true);
    expect(list.find((e) => e.id === created.id)?.hasPin).toBe(true);
    expect(list.some((e) => e.name === "Πελάτης QR")).toBe(false);
  });

  it("hard-deletes an employee without history and archives one with history", async () => {
    const fresh = await upsertEmployee({ name: "Προσωρινός", role: "waiter", pin: "7777" });
    expect(await deleteEmployee(fresh.id, admin.id)).toBe("deleted");
    expect((await listEmployees(true)).some((e) => e.id === fresh.id)).toBe(false);

    const maria = await employeeByName("Μαρία");
    const t = await tableByName("Κ9");
    const p = await productByName("Espresso");
    const s = await openSession({ tableId: t.id }, maria.id);
    await sendRound(s.id, [{ productId: p.id, qty: 1 }], maria.id);
    expect(await deleteEmployee(maria.id, admin.id)).toBe("archived");
    expect((await listEmployees(true)).some((e) => e.id === maria.id)).toBe(false);
    expect(await loginWithPin("1111")).toBeNull();
    // το ιστορικό διατηρεί το όνομα
    const db = await getDb();
    const row = await db.query.employees.findFirst({ where: eq(schema.employees.id, maria.id) });
    expect(row?.name).toBe("Μαρία");
    expect(row?.deletedAt).not.toBeNull();
    await expect(deleteEmployee(admin.id, admin.id)).rejects.toThrow(/εαυτό/);
  });
});
