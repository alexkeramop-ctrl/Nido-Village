import { describe, expect, it } from "vitest";
import { addMinutes, isMonToThu, quoteParty } from "@/components/admin/events/party";

describe("τιμή παιδικού πάρτι", () => {
  it("Σάββατο: πακέτο × παιδιά + πιατέλα ενηλίκων + έξτρα", () => {
    const q = quoteParty({ package: "bounce", kids: 18, adults: 16, adultMenu: "classic", extras: ["pinata"] }, "2026-11-21");
    expect(q.totalCents).toBe(18 * 1500 + 16 * 500 + 2500);
  });
  it("Δευτέρα–Πέμπτη: −€1 ανά παιδί", () => {
    expect(isMonToThu("2026-11-19")).toBe(true);
    const q = quoteParty({ package: "jump", kids: 10 }, "2026-11-19");
    expect(q.totalCents).toBe(10 * 1600 - 10 * 100);
  });
  it("διάρκεια 2,5 ωρών", () => {
    expect(addMinutes("11:00", 150)).toBe("13:30");
    expect(addMinutes("23:00", 150)).toBe("23:59");
  });
});
