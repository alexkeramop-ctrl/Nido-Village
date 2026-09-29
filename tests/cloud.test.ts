import { beforeAll, describe, expect, it } from "vitest";
import { seeded, employeeByName, productByName, tableByName } from "./helpers";
import { openSession, sendRound } from "@/server/services/ordering";
import { addPayment } from "@/server/services/billing";
import { computeSnapshot, getDailyHistory, getLatestSnapshot, storeSnapshot } from "@/server/cloud/snapshot";
import { listPartnerUsers, partnerLogin, upsertPartnerUser } from "@/server/services/partners";

let waiter: { id: number };
let cashier: { id: number };
beforeAll(async () => {
  await seeded();
  waiter = await employeeByName("Μαρία");
  cashier = await employeeByName("Νίκος");
});

describe("cloud snapshot", () => {
  it("computes, stores and reads back a snapshot with daily history", async () => {
    const t = await tableByName("Κ3");
    const p = await productByName("Καλαμάρι τηγανητό");
    const s = await openSession({ tableId: t.id, covers: 2 }, waiter.id);
    await sendRound(s.id, [{ productId: p.id, qty: 2 }], waiter.id);
    await addPayment(s.id, { method: "card", amountCents: 2600 }, cashier.id);

    const snap = await computeSnapshot();
    expect(snap.version).toBe(1);
    expect(snap.venueName).toBe("Nido Village");
    expect(snap.today.grossCents).toBe(2600);
    expect(snap.mtd.grossCents).toBe(2600);
    expect(snap.topProducts30[0].name).toBe("Καλαμάρι τηγανητό");
    expect(snap.live.openSessions).toBe(0);
    expect(snap.printers.map((x) => x.name)).toContain("Κουζίνα");

    expect(await getLatestSnapshot()).toBeNull();
    await storeSnapshot(snap);
    const latest = await getLatestSnapshot();
    expect(latest?.snapshot.today.grossCents).toBe(2600);
    const hist = await getDailyHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].day).toBe(snap.today.range.from);
    // second store for the same day overwrites instead of duplicating
    await storeSnapshot({ ...snap, computedAt: new Date().toISOString() });
    expect(await getDailyHistory()).toHaveLength(1);
  });
});

describe("partner users", () => {
  it("creates a partner and logs in with email/password", async () => {
    await expect(upsertPartnerUser({ name: "Κώστας", email: "bad", password: "12345678" })).rejects.toThrow(/email/);
    await expect(upsertPartnerUser({ name: "Κώστας", email: "k@example.com", password: "short" })).rejects.toThrow(/8/);
    const u = await upsertPartnerUser({ name: "Κώστας", email: "K@Example.com", password: "secret123" });
    expect(u.email).toBe("k@example.com");
    expect(await partnerLogin("k@example.com", "wrong")).toBeNull();
    const ok = await partnerLogin("k@example.com", "secret123");
    expect(ok?.name).toBe("Κώστας");
    const list = await listPartnerUsers();
    const created = list.find((p) => p.email === "k@example.com")!;
    expect(created).toBeDefined();
    expect("passwordHash" in created).toBe(false);
    // ο demo συνεταίρος του seed
    expect(await partnerLogin("partner@nido.demo", "nido-demo-2026")).not.toBeNull();
    await upsertPartnerUser({ id: u.id, name: "Κώστας", email: u.email, active: false });
    expect(await partnerLogin("k@example.com", "secret123")).toBeNull();
  });
});
