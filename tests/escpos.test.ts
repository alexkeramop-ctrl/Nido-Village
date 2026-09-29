import { describe, expect, it } from "vitest";
import { buildEscpos, encodeText } from "@/server/printing/escpos";
import { renderText, wrap } from "@/server/printing/ticket";
import { kitchenTicket, billTicket, testTicket } from "@/server/printing/templates";

describe("ticket rendering", () => {
  it("wraps long greek text", () => {
    expect(wrap("Μπριζόλα χοιρινή με πατάτες τηγανητές", 14)).toEqual(["Μπριζόλα", "χοιρινή με", "πατάτες", "τηγανητές"]);
  });

  it("renders kitchen ticket with greek, table, items and modifiers", () => {
    const doc = kitchenTicket({
      stationName: "Κουζίνα",
      tableName: "Α3",
      orderType: "dine_in",
      waiter: "Μαρία",
      roundNo: 2,
      time: new Date("2026-09-29T18:30:00Z"),
      items: [
        { qty: 2, name: "Μπριζόλα χοιρινή", modifiers: ["Μέτριο", "Extra πατάτες"], notes: "χωρίς αλάτι", course: 2 },
        { qty: 1, name: "Χωριάτικη", modifiers: [], course: 1 },
      ],
      notes: "Παιδί στο τραπέζι",
    });
    const text = renderText(doc, 42);
    expect(text).toContain("ΤΡΑΠΕΖΙ Α3");
    expect(text).toContain("2 X ΜΠΡΙΖΟΛΑ ΧΟΙΡΙΝΗ");
    expect(text).toContain("+ Extra πατάτες");
    expect(text).toContain("** χωρίς αλάτι");
    expect(text).toContain("1ο ΠΙΑΤΟ");
    expect(text).toContain("ΣΗΜ.: Παιδί στο τραπέζι");
    expect(text).toContain("21:30"); // Europe/Athens
  });

  it("renders bill with totals and disclaimer", () => {
    const doc = billTicket({
      venueName: "Nido Village",
      tableName: "Κ2",
      waiter: "Μαρία",
      time: new Date(),
      covers: 3,
      lines: [{ qty: 2, name: "Μπύρα Fix 500ml", modifiers: [], lineTotalCents: 1000 }],
      subtotalCents: 1000,
      discountCents: 100,
      totalCents: 900,
      vat: [{ ratePct: 24, netCents: 726, vatCents: 174, grossCents: 900 }],
      sessionId: 7,
    });
    const text = renderText(doc, 42);
    expect(text).toContain("ΣΥΝΟΛΟ");
    expect(text).toContain("9,00 €");
    expect(text).toContain("ΔΕΝ ΑΠΟΤΕΛΕΙ ΦΟΡΟΛΟΓΙΚΟ ΣΤΟΙΧΕΙΟ");
    expect(text).toContain("Έκπτωση");
  });
});

describe("escpos bytes", () => {
  it("starts with init and selects greek codepage 737", () => {
    const bytes = buildEscpos(testTicket("Κουζίνα", 42), { codepage: "cp737", columns: 42, cutter: true, drawerKick: false });
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.subarray(2, 5)]).toEqual([0x1b, 0x74, 14]);
    // partial cut present
    expect(bytes.includes(Buffer.from([0x1d, 0x56, 0x01]))).toBe(true);
    // QR store command present
    expect(bytes.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]))).toBe(true);
  });

  it("encodes greek capital alpha correctly per codepage", () => {
    expect(encodeText("Α", "cp737")[0]).toBe(0x80);
    expect(encodeText("Α", "cp1253")[0]).toBe(0xc1);
    expect(encodeText("Α", "iso8859-7")[0]).toBe(0xc1);
  });

  it("replaces euro sign for cp737 and keeps it for cp1253", () => {
    expect(encodeText("5 €", "cp737").toString("latin1")).toContain("EUR");
    expect(encodeText("€", "cp1253")[0]).toBe(0x80);
  });

  it("uses codepage 47 for windows-1253 and omits cut when cutter disabled", () => {
    const bytes = buildEscpos({ lines: [{ t: "text", text: "x" }, { t: "cut" }] }, { codepage: "cp1253", columns: 42, cutter: false, drawerKick: false });
    expect([...bytes.subarray(2, 5)]).toEqual([0x1b, 0x74, 47]);
    expect(bytes.includes(Buffer.from([0x1d, 0x56, 0x01]))).toBe(false);
  });
});

describe("logo image", () => {
  it("emits a GS v 0 raster block with the right size and renders a placeholder in text", async () => {
    const { logoImage } = await import("@/server/printing/logo");
    const img = logoImage();
    expect(img.width).toBe(384);
    expect(Buffer.from(img.data, "base64").length).toBe(Math.ceil(img.width / 8) * img.height);
    const bytes = buildEscpos({ lines: [{ t: "image", ...img }] }, { codepage: "cp737", columns: 48, cutter: false, drawerKick: false });
    expect(bytes.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00, 48, 0, img.height & 0xff, img.height >> 8]))).toBe(true);
    expect(renderText({ lines: [{ t: "image", ...img }] }, 42)).toContain("[ΛΟΓΟΤΥΠΟ 384x");
  });
});
