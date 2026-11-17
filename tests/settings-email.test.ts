import { beforeAll, describe, expect, it } from "vitest";
import { seeded } from "./helpers";
import { getSettings, saveSettings } from "@/server/services/settings";
import { receiptTicket } from "@/server/printing/templates";
import { renderText } from "@/server/printing/ticket";

beforeAll(async () => {
  await seeded();
});

describe("email καταστήματος", () => {
  it("είναι κενό μέχρι να το συμπληρώσει ο διαχειριστής και αποθηκεύεται χωρίς να χαθούν τα υπόλοιπα στοιχεία", async () => {
    const before = await getSettings();
    expect(before.email).toBe("");
    expect(before.phone).toBe("694 627 3127");
    await saveSettings({ email: "info@example.com" });
    const after = await getSettings();
    expect(after.email).toBe("info@example.com");
    expect(after.phone).toBe(before.phone);
    expect(after.address).toBe(before.address);
  });

  it("τυπώνεται στην απόδειξη μόνο όταν έχει οριστεί", () => {
    const base = {
      venueName: "Nido Village",
      tableName: "#1",
      waiter: "Νίκος",
      time: new Date("2026-11-17T10:00:00Z"),
      covers: 0,
      lines: [{ qty: 1, name: "Espresso", modifiers: [], lineTotalCents: 200 }],
      subtotalCents: 200,
      discountCents: 0,
      totalCents: 200,
      vat: [{ ratePct: 13, netCents: 177, vatCents: 23, grossCents: 200 }],
      sessionId: 1,
      fiscal: { providerName: "test" },
      payments: [{ method: "cash" as const, amountCents: 200 }],
    };
    const venue = { vatNumber: "123456789", address: "Βασιλικά Θέρμης", phone: "694 627 3127", taxOffice: "Θέρμης" };
    expect(renderText(receiptTicket({ ...base, venue: { ...venue, email: "info@example.com" } }), 42)).toContain("Email: info@example.com");
    expect(renderText(receiptTicket({ ...base, venue }), 42)).not.toContain("Email");
  });
});
