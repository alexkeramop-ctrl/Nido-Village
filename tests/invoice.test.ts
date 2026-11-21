import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName, ingredientByName } from "./helpers";
import { cleanVat, convertLine, guessFactor, invoiceUnitKind, nameScore, normalizeItemKey, suggestIngredient } from "@/lib/invoice-match";
import { draftFromExtraction, receiveInvoice } from "@/server/services/invoice-receipt";
import type { ExtractedInvoice } from "@/server/services/invoice-reader";
import { num } from "@/server/money";

let admin: { id: number };
beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});

describe("αντιστοίχιση γραμμών τιμολογίου (καθαρές συναρτήσεις)", () => {
  it("κλειδί γραμμής: ίδιο για ίδια περιγραφή με άλλους τόνους/κενά/κεφαλαία", () => {
    expect(normalizeItemKey("ΓΑΛΑ  ΦΡΕΣΚΟ  πλήρες 1lt")).toBe(normalizeItemKey("Γάλα φρέσκο ΠΛΗΡΕΣ 1lt"));
    expect(normalizeItemKey("Καφές", "A-12")).toBe("a-12|καφεσ");
  });
  it("μονάδες και συντελεστής μετατροπής", () => {
    expect(invoiceUnitKind("ΚΙΛ")).toBe("kg");
    expect(invoiceUnitKind("Λίτρα")).toBe("l");
    expect(invoiceUnitKind("ΤΕΜ.")).toBe("pcs");
    expect(invoiceUnitKind("ΚΙΒ")).toBeNull();
    expect(guessFactor("ΚΙΛ", "g")).toBe(1000);
    expect(guessFactor("LT", "ml")).toBe(1000);
    expect(guessFactor("ΤΕΜ", "pcs")).toBe(1);
    // Φιάλη 700 ml: ένα τεμάχιο του τιμολογίου = μία συσκευασία.
    expect(guessFactor("ΤΕΜ", "ml", 700)).toBe(700);
    // Κιβώτιο σε τεμάχια: δεν μαντεύει (το συμπληρώνει ο χρήστης).
    expect(guessFactor("ΚΙΒ", "g")).toBeNull();
    expect(convertLine(2, 12.5, 1000)).toEqual({ qty: 2000, unitCost: 0.0125 });
    expect(() => convertLine(1, 1, 0)).toThrow();
  });
  it("ΑΦΜ και ομοιότητα ονομάτων", () => {
    expect(cleanVat("EL 094.019.245")).toBe("094019245");
    expect(nameScore("ΚΑΦΕΣ ESPRESSO ΚΟΚΚΟΙ 1KG", "Καφές espresso")).toBe(1);
    const list = [
      { id: 1, name: "Γάλα" },
      { id: 2, name: "Καφές espresso" },
    ];
    expect(suggestIngredient("ΚΑΦΕΣ ESPRESSO ΚΟΚΚΟΙ 1KG", list)?.id).toBe(2);
    expect(suggestIngredient("ΧΑΡΤΟΠΕΤΣΕΤΕΣ", list)).toBeNull();
  });
});

const invoice = (over: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
  is_invoice: true,
  supplier_name: "ΚΑΦΕΚΟΠΤΕΙΟ ΝΕΟ ΑΕ",
  supplier_vat: "EL 999888777",
  doc_type: "Τιμολόγιο Πώλησης",
  doc_number: "Α 1001",
  doc_date: "2026-11-20",
  lines: [
    { code: "K1", description: "ΚΑΦΕΣ ESPRESSO ΚΟΚΚΟΙ", quantity: 2, unit: "ΚΙΛ", unit_price_net: 21, discount_pct: null, line_net: 42, vat_pct: 13 },
    { code: null, description: "ΧΑΡΤΟΠΕΤΣΕΤΕΣ", quantity: 10, unit: "ΠΑΚ", unit_price_net: 1.5, discount_pct: null, line_net: 15, vat_pct: 24 },
  ],
  total_net: 57,
  total_vat: 9.06,
  total_gross: 66.06,
  warnings: [],
  ...over,
});

describe("τιμολόγιο → παραλαβή", () => {
  it("προτείνει πρώτη ύλη και μετατροπή, ελέγχει αθροίσματα", async () => {
    const coffee = await ingredientByName("Καφές espresso");
    const d = await draftFromExtraction(invoice());
    expect(d.supplier).toMatchObject({ id: null, name: "ΚΑΦΕΚΟΠΤΕΙΟ ΝΕΟ ΑΕ", vat: "999888777" });
    expect(d.lines[0]).toMatchObject({ ingredientId: coffee.id, factor: 1000, source: "name", unitPriceNet: 21 });
    expect(d.lines[1]).toMatchObject({ ingredientId: null, factor: null, source: null });
    expect(d.linesNet).toBe(57);
    expect(d.warnings).toEqual([]);
    const bad = await draftFromExtraction(invoice({ total_net: 60 }));
    expect(bad.warnings.join(" ")).toMatch(/δεν συμφωνεί/);
  });

  it("καταχωρεί, φτιάχνει τον προμηθευτή, θυμάται την αντιστοίχιση και μπλοκάρει διπλή καταχώρηση", async () => {
    const db = await getDb();
    const coffee = await ingredientByName("Καφές espresso");
    const before = num(coffee.stockQty);
    const d = await draftFromExtraction(invoice());
    const input = {
      supplierId: null,
      newSupplier: { name: d.supplier.name!, vat: d.supplier.vat },
      docNumber: d.docNumber,
      docDate: new Date("2026-11-20T12:00:00"),
      lines: [{ itemKey: d.lines[0].itemKey, ingredientId: coffee.id, quantity: 2, unitPriceNet: 21, factor: 1000, remember: true }],
    };
    const r = await receiveInvoice(input, admin.id);
    expect(r.totalCents).toBe(4200);
    const after = await ingredientByName("Καφές espresso");
    expect(num(after.stockQty)).toBeCloseTo(before + 2000, 3);
    const line = await db.query.goodsReceiptLines.findFirst({ where: eq(schema.goodsReceiptLines.receiptId, r.id) });
    expect(num(line!.unitCost)).toBeCloseTo(0.021, 4);
    const supplier = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, r.supplierId!) });
    expect(supplier).toMatchObject({ name: "ΚΑΦΕΚΟΠΤΕΙΟ ΝΕΟ ΑΕ", vatNumber: "999888777" });

    // Το επόμενο τιμολόγιο του ίδιου προμηθευτή: βρίσκει τον προμηθευτή από ΑΦΜ και τη γραμμή από τη μνήμη.
    const again = await draftFromExtraction(invoice({ supplier_name: "Καφεκοπτείο Νέο", doc_number: "Α 1002" }));
    expect(again.supplier).toMatchObject({ id: r.supplierId, matchedBy: "vat" });
    expect(again.lines[0]).toMatchObject({ ingredientId: coffee.id, factor: 1000, source: "alias" });
    expect(again.duplicateOf).toBeNull();

    // Ίδιος αριθμός παραστατικού: εντοπίζεται και δεν ξαναπερνά χωρίς ρητή επιβεβαίωση.
    const dup = await draftFromExtraction(invoice({ doc_number: " α 1001 " }));
    expect(dup.duplicateOf?.id).toBe(r.id);
    await expect(receiveInvoice({ ...input, supplierId: r.supplierId, newSupplier: null }, admin.id)).rejects.toThrow(/ήδη καταχωρηθεί/);
    const forced = await receiveInvoice({ ...input, supplierId: r.supplierId, newSupplier: null, allowDuplicate: true }, admin.id);
    expect(forced.id).not.toBe(r.id);
    // Δεν δημιουργήθηκε δεύτερος προμηθευτής με τον ίδιο ΑΦΜ.
    const same = (await db.query.suppliers.findMany()).filter((s) => s.vatNumber === "999888777");
    expect(same).toHaveLength(1);
  });

  it("απορρίπτει γραμμές χωρίς σωστή μετατροπή ή τιμή", async () => {
    const coffee = await ingredientByName("Καφές espresso");
    const base = { supplierId: null, docNumber: "Χ 1", docDate: new Date() };
    await expect(receiveInvoice({ ...base, lines: [{ itemKey: "x", ingredientId: coffee.id, quantity: 1, unitPriceNet: 5, factor: 0, remember: false }] }, admin.id)).rejects.toThrow(/μετατροπή/);
    await expect(receiveInvoice({ ...base, lines: [{ itemKey: "x", ingredientId: coffee.id, quantity: 1, unitPriceNet: NaN, factor: 1, remember: false }] }, admin.id)).rejects.toThrow(/τιμή/);
    await expect(receiveInvoice({ ...base, lines: [] }, admin.id)).rejects.toThrow(/πρώτη ύλη/);
  });
});

describe("κλήση ανάγνωσης (με ψεύτικο API)", () => {
  const sample = {
    is_invoice: true,
    supplier_name: "ΜΑΝΟΣ ΠΟΤΑ ΑΕ",
    supplier_vat: "123456789",
    doc_type: "ΤΔΑ",
    doc_number: "Β 77",
    doc_date: "2026-11-19",
    lines: [{ code: null, description: "ΓΑΛΑ ΦΡΕΣΚΟ 1LT", quantity: 12, unit: "ΤΕΜ", unit_price_net: 1.1, discount_pct: null, line_net: 13.2, vat_pct: 13 }],
    total_net: 13.2,
    total_vat: 1.72,
    total_gross: 14.92,
    warnings: [],
  };
  const realFetch = globalThis.fetch;
  const pdf = { data: new TextEncoder().encode("%PDF-1.4 test"), mediaType: "application/pdf" as const };

  async function withFetch(responses: Response[], fn: (calls: { url: string; init: RequestInit }[]) => Promise<void>) {
    const calls: { url: string; init: RequestInit }[] = [];
    process.env.ANTHROPIC_API_KEY = "test-key";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responses.shift() ?? new Response("{}", { status: 500 });
    }) as typeof fetch;
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("στέλνει μόνο το αρχείο με structured output και διαβάζει το JSON", async () => {
    const { readInvoiceFile, INVOICE_MODEL } = await import("@/server/services/invoice-reader");
    await withFetch([ok({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(sample) }] })], async (calls) => {
      const x = await readInvoiceFile(pdf);
      expect(x).toMatchObject({ supplier_vat: "123456789", doc_number: "Β 77", total_net: 13.2 });
      expect(x.lines[0]).toMatchObject({ quantity: 12, unit: "ΤΕΜ", unit_price_net: 1.1 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
      const h = calls[0].init.headers as Record<string, string>;
      expect(h["x-api-key"]).toBe("test-key");
      expect(h["anthropic-version"]).toBeTruthy();
      expect(h["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
      const body = JSON.parse(String(calls[0].init.body));
      expect(body.model).toBe(INVOICE_MODEL);
      expect(body.fallbacks).toBe("default");
      expect(body.output_config.format.type).toBe("json_schema");
      expect(body.output_config.format.schema.additionalProperties).toBe(false);
      expect(body.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
      expect(body).not.toHaveProperty("temperature");
    });
  });

  it("ξαναδοκιμάζει σε υπερφόρτωση και δίνει καθαρά μηνύματα σε λάθος κλειδί / άρνηση", async () => {
    const { readInvoiceFile } = await import("@/server/services/invoice-reader");
    await withFetch([new Response("{}", { status: 529, headers: { "retry-after": "0.01" } }), ok({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(sample) }] })], async (calls) => {
      await readInvoiceFile(pdf);
      expect(calls).toHaveLength(2);
    });
    await withFetch([new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })], async () => {
      await expect(readInvoiceFile(pdf)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });
    await withFetch([ok({ stop_reason: "refusal", content: [] })], async () => {
      await expect(readInvoiceFile(pdf)).rejects.toThrow(/χειροκίνητα/);
    });
    await expect(readInvoiceFile(pdf)).rejects.toThrow(/δεν είναι ενεργή/);
  });
});
