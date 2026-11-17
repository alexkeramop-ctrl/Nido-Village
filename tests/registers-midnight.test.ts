import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, productByName } from "./helpers";
import { closeRegisterShift, daySummary, listRegisters, openRegisterShift } from "@/server/services/registers";
import { quickSale, tillSnapshot, type TillEmployee } from "@/server/services/till";
import { financeMonth } from "@/server/services/finance";
import { addDays, athensDayStart, todayAthens } from "@/server/services/reports";

let cashier: TillEmployee;
const today = todayAthens();
const yesterday = addDays(today, -1);

/** Έσοδα ταμείου μιας ημερομηνίας όπως τα δείχνουν τα Έσοδα – Έξοδα (κάθε πληρωμή στην ημερομηνία της). */
async function financeIncome(date: string): Promise<number> {
  const fin = await financeMonth(date.slice(0, 7));
  return fin.days.find((d) => d.date === date)?.income ?? 0;
}

beforeAll(async () => {
  await seeded();
  const c = await employeeByName("Νίκος");
  cashier = { id: c.id, name: c.name, role: c.role };
});

describe("σύνοψη ημέρας όταν μια βάρδια περνά τα μεσάνυχτα", () => {
  it("κάθε είσπραξη φαίνεται σε ΜΙΑ ημέρα (αυτή που άνοιξε η βάρδια) και η συμφωνία με τα Έσοδα – Έξοδα είναι ρητή", async () => {
    const db = await getDb();
    const cola = await productByName("Coca-Cola 330ml");
    const [r1, r2] = await listRegisters();
    const finBefore = { today: await financeIncome(today), yesterday: await financeIncome(yesterday) };

    // Ταμείο 1: βάρδια που άνοιξε ΧΘΕΣ στις 20:00 (ώρα Αθήνας) και δεν έκλεισε.
    const openedAt = new Date(athensDayStart(yesterday).getTime() + 20 * 3600_000);
    const late = await openRegisterShift(r1.id, 5000, cashier.id);
    await db.update(schema.cashSessions).set({ openedAt }).where(eq(schema.cashSessions.id, late.id));
    // Χθες 21:00: 4 × 2,50 = 10,00 μετρητά.
    const a = await quickSale({ cashSessionId: late.id, clientRef: "midnight-test-a", lines: [{ productId: cola.id, qty: 4 }], tender: { cashCents: 1000, cardCents: 0 } }, cashier);
    const paidAt = new Date(openedAt.getTime() + 3600_000);
    await db.update(schema.payments).set({ createdAt: paidAt }).where(eq(schema.payments.sessionId, a.sessionId));
    await db.update(schema.tableSessions).set({ openedAt: paidAt, closedAt: paidAt }).where(eq(schema.tableSessions.id, a.sessionId));
    // Σήμερα (μετά τα μεσάνυχτα), στην ΙΔΙΑ βάρδια: 2 × 2,50 = 5,00 μετρητά.
    await quickSale({ cashSessionId: late.id, clientRef: "midnight-test-b", lines: [{ productId: cola.id, qty: 2 }], tender: { cashCents: 500, cardCents: 0 } }, cashier);
    // Ταμείο 2: κανονική σημερινή βάρδια με 2,50 κάρτα.
    const normal = await openRegisterShift(r2.id, 0, cashier.id);
    await quickSale({ cashSessionId: normal.id, clientRef: "midnight-test-c", lines: [{ productId: cola.id, qty: 1 }], tender: { cashCents: 0, cardCents: 250 } }, cashier);

    // Το ταμείο λέει στον ταμία ότι δουλεύει σε χθεσινή βάρδια.
    expect((await tillSnapshot(r1.id)).shiftFromEarlierDay).toBe(true);
    expect((await tillSnapshot(r2.id)).shiftFromEarlierDay).toBe(false);

    const check = async (closed: boolean) => {
      const t = await daySummary(today);
      const y = await daySummary(yesterday);

      // ΣΗΜΕΡΑ: η χθεσινή βάρδια ΔΕΝ μετρά στα σημερινά σύνολα· όσο είναι ανοιχτή φαίνεται χωριστά ως προειδοποίηση.
      expect(t.registers.find((r) => r.name === "Ταμείο 1")!.shifts).toEqual([]);
      expect(t.registers.find((r) => r.name === "Ταμείο 1")!.totals.totalCents).toBe(0);
      expect(t.registers.find((r) => r.name === "Ταμείο 2")!.totals).toMatchObject({ shifts: 1, salesCount: 1, cardCents: 250, totalCents: 250 });
      expect(t.carriedOver.map((s) => [s.id, s.totalCents, s.openedDate])).toEqual(closed ? [] : [[late.id, 1500, yesterday]]);
      expect(t.total.shifts).toBe(1);
      expect(t.grandTotalCents).toBe(250);
      expect(t.calendar).toEqual({ totalCents: 750, afterDayCents: 0, earlierShiftsCents: 500 });

      // ΧΘΕΣ: ολόκληρη η βάρδια (15,00), με σημείωση ότι τα 5,00 εισπράχθηκαν μετά τα μεσάνυχτα.
      const y1 = y.registers.find((r) => r.name === "Ταμείο 1")!;
      expect(y1.shifts).toHaveLength(1);
      expect(y1.shifts[0]).toMatchObject({ id: late.id, salesCount: 2, totalCents: 1500, expectedCashCents: 6500, afterDayCents: 500, closedAfterDay: closed, diffCents: closed ? -100 : null });
      expect(y1.totals).toMatchObject({ cashCents: 1500, totalCents: 1500, openShifts: closed ? 0 : 1 });
      expect(y.carriedOver).toEqual([]);
      expect(y.grandTotalCents).toBe(1500);
      expect(y.calendar).toEqual({ totalCents: 1000, afterDayCents: 500, earlierShiftsCents: 0 });

      // Συμφωνία με τα Έσοδα – Έξοδα, ημέρα προς ημέρα, και κανένα ευρώ σε δύο ημερομηνίες.
      for (const d of [t, y]) expect(d.calendar.totalCents).toBe(d.grandTotalCents - d.calendar.afterDayCents + d.calendar.earlierShiftsCents);
      expect(t.calendar.totalCents).toBe((await financeIncome(today)) - finBefore.today);
      expect(y.calendar.totalCents).toBe((await financeIncome(yesterday)) - finBefore.yesterday);
      expect(t.grandTotalCents + y.grandTotalCents).toBe(1750);
      expect(t.calendar.totalCents + y.calendar.totalCents).toBe(1750);
    };

    await check(false);
    // Κλείνει σήμερα με 64,00 αντί 65,00 (έλλειμμα 1,00): τα ποσά κάθε ημέρας ΔΕΝ μετακινούνται με το κλείσιμο.
    const done = await closeRegisterShift(late.id, 6400, cashier.id);
    expect(done.diffCents).toBe(-100);
    await check(true);
    expect((await tillSnapshot(r1.id)).shift).toBeNull();
    expect((await tillSnapshot(r1.id)).shiftFromEarlierDay).toBe(false);
  });
});
