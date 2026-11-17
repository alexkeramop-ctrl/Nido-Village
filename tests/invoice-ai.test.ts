import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { employeeByName, seeded } from "./helpers";
import { signSession, type SessionUser } from "@/server/auth";
import { extractJsonObject, normalizeReading } from "@/lib/invoices";
import {
  ANTHROPIC_MESSAGES_URL,
  INVOICE_INSTRUCTION,
  INVOICE_SCHEMA,
  InvoiceAiError,
  aiConfigured,
  buildInvoiceRequest,
  invoiceModel,
  parseInvoiceResponse,
  readInvoiceWithAi,
} from "@/server/services/invoice-ai";
import { invoiceFeatures } from "@/server/services/invoice-files";
import { saveSettings } from "@/server/services/settings";

const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "nido_session" && session.token ? { name, value: session.token } : undefined) }),
  headers: async () => new Headers(),
}));

import { POST as readRoute } from "@/app/api/invoices/read/route";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const KEY = "sk-ant-test-key-000";

/** Ό,τι θα επέστρεφε το μοντέλο για ένα καθαρό τιμολόγιο. */
const GOOD = {
  supplier_name: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ",
  supplier_afm: "090000045",
  document_number: "ΤΔΑ 1532",
  document_date: "2026-11-05",
  net_amount: 100,
  vat_amount: 24,
  total_amount: 124,
  currency: "EUR",
  confidence: { supplier_name: "high", supplier_afm: "high", document_number: "high", document_date: "high", net_amount: "high", vat_amount: "high", total_amount: "high" },
};
const message = (text: string, extra: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1500, output_tokens: 120 },
  ...extra,
});
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Sent = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown>; raw: string };
function mockAnthropic(respond: (sent: Sent, init: RequestInit) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const raw = String(init.body ?? "");
    const s: Sent = { url: String(input), method: init.method ?? "GET", headers, body: JSON.parse(raw) as Record<string, unknown>, raw };
    sent.push(s);
    return respond(s, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, fetchMock };
}

let admin: SessionUser;
let waiter: SessionUser;
beforeAll(async () => {
  await seeded();
  const a = await employeeByName("Αλέξης");
  const w = await employeeByName("Μαρία");
  admin = { id: a.id, name: a.name, role: a.role };
  waiter = { id: w.id, name: w.name, role: w.role };
  // Στοιχεία του καταστήματος που ΔΕΝ πρέπει να φτάσουν ποτέ στο API.
  await saveSettings({ venueName: "Nido Village Secret Name", vatNumber: "094014201", address: "Κρυφή Οδός 7", phone: "6900000000" });
});
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = KEY;
  delete process.env.INVOICE_AI_MODEL;
  session.token = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.INVOICE_AI_MODEL;
});

describe("request to the Messages API", () => {
  it("sends only the file and the instruction", () => {
    const req = buildInvoiceRequest({ bytes: PDF, kind: "pdf" });
    expect(req.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    });
    expect(Object.keys(req.body).sort()).toEqual(["fallbacks", "max_tokens", "messages", "model", "output_config"]);
    expect(req.body.model).toBe("claude-sonnet-5-5");
    expect(req.body.max_tokens).toBe(16000);
    expect(req.body.fallbacks).toBe("default");
    expect(req.body.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: INVOICE_SCHEMA } });
    // Ένα μήνυμα χρήστη με δύο μέρη: το αρχείο (base64) και η σταθερή οδηγία.
    expect(req.body.messages).toHaveLength(1);
    const [msg] = req.body.messages;
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF).toString("base64") } },
      { type: "text", text: INVOICE_INSTRUCTION },
    ]);
    // Ούτε system prompt, ούτε εργαλεία, ούτε παράμετροι δειγματοληψίας, ούτε στοιχεία του καταστήματος.
    const wire = JSON.stringify(req.body);
    for (const absent of ["system", "tools", "temperature", "top_p", "metadata", "Nido", "094014201", "Κρυφή", "6900000000"]) expect(wire).not.toContain(absent);
    expect(wire).not.toContain(KEY);
  });

  it("sends photos as image blocks with their real media type", () => {
    const req = buildInvoiceRequest({ bytes: JPG, kind: "jpg" });
    expect(req.body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(JPG).toString("base64") } });
    expect(buildInvoiceRequest({ bytes: JPG, kind: "png" }).body.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
    expect(buildInvoiceRequest({ bytes: JPG, kind: "webp" }).body.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/webp" } });
  });

  it("takes the model from INVOICE_AI_MODEL and only opts into fallbacks where they exist", () => {
    expect(invoiceModel()).toBe("claude-sonnet-5-5");
    process.env.INVOICE_AI_MODEL = " claude-haiku-5-5 ";
    expect(invoiceModel()).toBe("claude-haiku-5-5");
    const req = buildInvoiceRequest({ bytes: PDF, kind: "pdf" });
    expect(req.body.model).toBe("claude-haiku-5-5");
    expect("fallbacks" in req.body).toBe(false);
    expect("anthropic-beta" in req.headers).toBe(false);
    expect(req.headers["anthropic-version"]).toBe("2026-10-21");
  });

  it("asks for a strict schema: every field nullable, confidence per field", () => {
    const fields = ["supplier_name", "supplier_afm", "document_number", "document_date", "net_amount", "vat_amount", "total_amount"];
    expect(INVOICE_SCHEMA.additionalProperties).toBe(false);
    expect([...INVOICE_SCHEMA.required].sort()).toEqual([...fields, "confidence", "currency"].sort());
    expect(INVOICE_SCHEMA.properties.confidence.additionalProperties).toBe(false);
    expect([...INVOICE_SCHEMA.properties.confidence.required].sort()).toEqual([...fields].sort());
    expect(INVOICE_SCHEMA.properties.net_amount).toEqual({ anyOf: [{ type: "number" }, { type: "null" }] });
    expect(INVOICE_SCHEMA.properties.supplier_afm).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });
});

describe("parsing what the model returns", () => {
  it("turns clean JSON into form values with nothing to check", () => {
    const r = parseInvoiceResponse(message(JSON.stringify(GOOD)), { today: "2026-11-17" });
    expect(r).toEqual({
      supplierName: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ",
      afm: "090000045",
      docNumber: "ΤΔΑ 1532",
      date: "2026-11-05",
      netCents: 10000,
      vatCents: 2400,
      totalCents: 12400,
      currency: "EUR",
      confidence: { supplierName: "high", afm: "high", docNumber: "high", date: "high", net: "high", vat: "high", total: "high" },
      check: [],
      warnings: [],
    });
  });

  it("tolerates code fences, surrounding prose and Greek number/date formats", () => {
    const fenced = "```json\n" + JSON.stringify(GOOD) + "\n```";
    expect(parseInvoiceResponse(message(fenced)).totalCents).toBe(12400);
    const chatty = `Ορίστε τα στοιχεία:\n${JSON.stringify(GOOD)}\nΕλπίζω να βοηθά.`;
    expect(parseInvoiceResponse(message(chatty)).docNumber).toBe("ΤΔΑ 1532");
    const greek = { ...GOOD, supplier_afm: "EL 090000045", document_date: "05/11/2026", net_amount: "1.000,00", vat_amount: "240,00", total_amount: "1.240,00 €" };
    expect(parseInvoiceResponse(message(JSON.stringify(greek)))).toMatchObject({ afm: "090000045", date: "2026-11-05", netCents: 100000, vatCents: 24000, totalCents: 124000, check: [], warnings: [] });
    // Κείμενο μοιρασμένο σε περισσότερα text blocks (ακόμη και στη μέση μιας τιμής): ενώνεται όπως είναι.
    const whole = JSON.stringify(GOOD);
    const split = message("", { content: [{ type: "text", text: whole.slice(0, 25) }, { type: "thinking", thinking: "" }, { type: "text", text: whole.slice(25) }] });
    expect(parseInvoiceResponse(split)).toMatchObject({ supplierName: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ", totalCents: 12400, check: [] });
  });

  it("rejects malformed output with a Greek message instead of guessing", () => {
    const manual = /Συμπλήρωσε τα πεδία με το χέρι/;
    for (const text of ["Δεν μπόρεσα να διαβάσω το αρχείο.", '{"supplier_name": "ΚΑΒΑ", "net_amount": 12', "[1, 2, 3]", '"just a string"', "null", "{not json}", "```json\n```"]) {
      expect(() => parseInvoiceResponse(message(text)), text).toThrow(manual);
    }
    expect(() => extractJsonObject("")).toThrow(manual);
    // Απάντηση χωρίς κείμενο, άρνηση, κομμένη απάντηση, άσχετο σχήμα.
    expect(() => parseInvoiceResponse(message("", { content: [] }))).toThrow(InvoiceAiError);
    expect(() => parseInvoiceResponse(message("", { content: [{ type: "thinking", thinking: "" }] }))).toThrow(/δεν επέστρεψε στοιχεία/);
    expect(() => parseInvoiceResponse(message(JSON.stringify(GOOD), { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms" } }))).toThrow(/αρνήθηκε/);
    expect(() => parseInvoiceResponse(message(JSON.stringify(GOOD).slice(0, 50), { stop_reason: "max_tokens" }))).toThrow(/δεν ολοκληρώθηκε/);
    for (const junk of [null, undefined, "text", 42, {}, { content: "x" }, { content: [{ type: "text" }] }]) expect(() => parseInvoiceResponse(junk)).toThrow(InvoiceAiError);
  });

  it("flags missing and low-confidence fields for review", () => {
    const partial = {
      ...GOOD,
      supplier_afm: null,
      document_number: null,
      confidence: { ...GOOD.confidence, supplier_afm: "low", document_number: "low", document_date: "medium", supplier_name: "low" },
    };
    const r = parseInvoiceResponse(message(JSON.stringify(partial)));
    expect(r.afm).toBeNull();
    expect(r.docNumber).toBeNull();
    expect(r.check).toEqual(["supplierName", "afm", "docNumber", "date"]);
    expect(r.confidence).toMatchObject({ supplierName: "low", date: "medium", total: "high" });
    // Χωρίς καθόλου confidence, ή με άγνωστες τιμές: όλα για έλεγχο.
    const none = parseInvoiceResponse(message(JSON.stringify({ ...GOOD, confidence: undefined })));
    expect(none.check).toEqual(["supplierName", "afm", "docNumber", "date", "net", "vat", "total"]);
    const odd = parseInvoiceResponse(message(JSON.stringify({ ...GOOD, confidence: { ...GOOD.confidence, total_amount: "certain", net_amount: 0.95, vat_amount: 0.3 } })));
    expect(odd.check).toEqual(["vat", "total"]);
    // «Δεν είναι τιμολόγιο»: όλα κενά, όλα για έλεγχο, τίποτα δεν προσυμπληρώνεται.
    const empty = Object.fromEntries(Object.keys(GOOD).map((k) => [k, k === "confidence" ? Object.fromEntries(Object.keys(GOOD.confidence).map((c) => [c, "low"])) : null]));
    expect(parseInvoiceResponse(message(JSON.stringify(empty)))).toMatchObject({ supplierName: null, afm: null, date: null, netCents: null, vatCents: null, totalCents: null, check: ["supplierName", "afm", "docNumber", "date", "net", "vat", "total"] });
  });

  it("re-validates locally: ΑΦΜ checksum, own ΑΦΜ, totals, dates, currency", () => {
    // ΑΦΜ με λάθος ψηφίο ελέγχου, ακόμη κι αν το μοντέλο είναι «σίγουρο».
    const badAfm = normalizeReading({ ...GOOD, supplier_afm: "090000046" });
    expect(badAfm.afm).toBe("090000046");
    expect(badAfm.check).toContain("afm");
    expect(badAfm.warnings.join(" ")).toMatch(/ΑΦΜ.*δεν περνά τον έλεγχο/);
    expect(normalizeReading({ ...GOOD, supplier_afm: "12345" }).check).toContain("afm");

    // Διαβάστηκε το ΑΦΜ του ίδιου του καταστήματος (του παραλήπτη).
    const own = normalizeReading(GOOD, { ownAfm: "EL090000045" });
    expect(own.afm).toBeNull();
    expect(own.check).toContain("afm");
    expect(own.warnings.join(" ")).toMatch(/δικό σου ΑΦΜ/);

    // Καθαρό + ΦΠΑ ≠ σύνολο.
    const off = normalizeReading({ ...GOOD, total_amount: 125 });
    expect(off).toMatchObject({ netCents: 10000, vatCents: 2400, totalCents: 12500 });
    expect(off.check).toEqual(["net", "vat", "total"]);
    expect(off.warnings.join(" ")).toMatch(/δεν ισούται με το σύνολο/);

    // Λείπει ένα ποσό: υπολογίζεται τοπικά και σημειώνεται για έλεγχο.
    const noVat = normalizeReading({ ...GOOD, vat_amount: null });
    expect(noVat).toMatchObject({ netCents: 10000, vatCents: 2400, totalCents: 12400 });
    expect(noVat.check).toEqual(["vat"]);
    const noTotal = normalizeReading({ ...GOOD, total_amount: null });
    expect(noTotal.totalCents).toBe(12400);
    expect(noTotal.check).toEqual(["total"]);
    // Αδύνατος υπολογισμός (σύνολο < καθαρό): δεν γράφεται αρνητικός ΦΠΑ.
    expect(normalizeReading({ ...GOOD, vat_amount: null, total_amount: 90 })).toMatchObject({ vatCents: null, check: expect.arrayContaining(["vat"]) });
    // Αρνητικά ποσά (πιστωτικό) δεν περνιούνται ποτέ αυτόματα.
    const credit = normalizeReading({ ...GOOD, net_amount: -100, vat_amount: -24, total_amount: -124 });
    expect(credit).toMatchObject({ netCents: null, vatCents: null, totalCents: null, check: ["net", "vat", "total"] });
    expect(credit.warnings.join(" ")).toMatch(/αρνητικά ποσά/);
    // Ένα μόνο αρνητικό (λάθος ανάγνωση): υπολογίζεται από τα άλλα δύο και μένει για έλεγχο.
    expect(normalizeReading({ ...GOOD, total_amount: -124 })).toMatchObject({ totalCents: 12400, check: ["total"] });

    // Ημερομηνίες: μη υπαρκτή, μελλοντική, πολύ παλιά.
    expect(normalizeReading({ ...GOOD, document_date: "31/02/2026" })).toMatchObject({ date: null, check: expect.arrayContaining(["date"]) });
    expect(normalizeReading({ ...GOOD, document_date: "2026-12-25" }, { today: "2026-11-17" }).check).toContain("date");
    expect(normalizeReading({ ...GOOD, document_date: "2019-01-01" }, { today: "2026-11-17" }).check).toContain("date");
    expect(normalizeReading(GOOD, { today: "2026-11-17" }).check).toEqual([]);

    // Άλλο νόμισμα.
    const usd = normalizeReading({ ...GOOD, currency: "usd" });
    expect(usd.currency).toBe("USD");
    expect(usd.check).toContain("total");
    expect(usd.warnings.join(" ")).toMatch(/USD/);

    // Λάθος τύποι από το μοντέλο δεν σπάνε τίποτα.
    const weird = normalizeReading({ supplier_name: { a: 1 }, supplier_afm: 90000045, document_number: 1532, document_date: 20261105, net_amount: "abc", vat_amount: [], total_amount: true, currency: 5, confidence: "high" });
    expect(weird).toMatchObject({ supplierName: null, docNumber: "1532", date: null, netCents: null, vatCents: null, totalCents: null });
    expect(weird.check).toEqual(["supplierName", "afm", "docNumber", "date", "net", "vat", "total"]);
    // Υπερβολικά μεγάλα κείμενα κόβονται.
    expect(normalizeReading({ ...GOOD, supplier_name: "Α".repeat(500), document_number: "9".repeat(500) })).toMatchObject({ supplierName: "Α".repeat(120), docNumber: "9".repeat(60) });
  });
});

describe("calling the API", () => {
  it("posts once and returns the checked reading", async () => {
    const { sent } = mockAnthropic(() => ok(message(JSON.stringify(GOOD))));
    const r = await readInvoiceWithAi({ bytes: JPG, kind: "jpg", ownAfm: "094014201", today: "2026-11-17" });
    expect(r).toMatchObject({ supplierName: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ", afm: "090000045", totalCents: 12400, check: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers["x-api-key"]).toBe(KEY);
    expect(sent[0].headers["anthropic-version"]).toBe("2026-10-21");
    expect(sent[0].body).toEqual(buildInvoiceRequest({ bytes: JPG, kind: "jpg" }).body);
    // Το δικό μας ΑΦΜ χρησιμοποιείται μόνο στον τοπικό έλεγχο: δεν ταξιδεύει.
    expect(sent[0].raw).not.toContain("094014201");
  });

  it("explains API errors in Greek without leaking details", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [number, string, RegExp][] = [
      [401, "authentication_error", /ANTHROPIC_API_KEY δεν έγινε δεκτό/],
      [403, "permission_error", /ANTHROPIC_API_KEY δεν έγινε δεκτό/],
      [404, "not_found_error", /μοντέλο ανάγνωσης «claude-sonnet-5-5» δεν βρέθηκε.*INVOICE_AI_MODEL/],
      [413, "request_too_large", /πολύ μεγάλο για ανάγνωση/],
      [429, "rate_limit_error", /πολλά αιτήματα.*Δοκίμασε ξανά/],
      [400, "invalid_request_error", /δεν δέχτηκε το αίτημα/],
      [500, "api_error", /δεν είναι διαθέσιμη αυτή τη στιγμή \(σφάλμα 500\)/],
      [529, "overloaded_error", /δεν είναι διαθέσιμη αυτή τη στιγμή \(σφάλμα 529\)/],
    ];
    for (const [status, type, re] of cases) {
      mockAnthropic(() => ok({ type: "error", error: { type, message: `internal detail ${KEY} should never reach the user` } }, status));
      const p = readInvoiceWithAi({ bytes: PDF, kind: "pdf" });
      await expect(p, String(status)).rejects.toBeInstanceOf(InvoiceAiError);
      await expect(p, String(status)).rejects.toThrow(re);
      await p.catch((e: Error) => expect(e.message).not.toContain("internal detail"));
    }
    // Στο log γράφεται μόνο κωδικός και τύπος σφάλματος, ποτέ το μήνυμα ή το κλειδί.
    expect(JSON.stringify(err.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(err.mock.calls)).not.toContain("internal detail");
    expect(err.mock.calls[0][0]).toBe("[nido] invoice AI: HTTP 401 authentication_error");

    mockAnthropic(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(readInvoiceWithAi({ bytes: PDF, kind: "pdf" })).rejects.toThrow(/σφάλμα 502/);
    mockAnthropic(() => new Response("not json at all", { status: 200 }));
    await expect(readInvoiceWithAi({ bytes: PDF, kind: "pdf" })).rejects.toThrow(/μη αναγνώσιμη απάντηση/);
    mockAnthropic(() => ok(message("Συγγνώμη, δεν βλέπω τιμολόγιο.")));
    await expect(readInvoiceWithAi({ bytes: PDF, kind: "pdf" })).rejects.toThrow(/Συμπλήρωσε τα πεδία με το χέρι/);
  });

  it("gives up cleanly on network failures and timeouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(readInvoiceWithAi({ bytes: PDF, kind: "pdf" })).rejects.toThrow(/Δεν υπάρχει επικοινωνία με την υπηρεσία ανάγνωσης/);

    // Ο server δεν απαντά ποτέ: το αίτημα ακυρώνεται μετά από 75".
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );
    const p = readInvoiceWithAi({ bytes: PDF, kind: "pdf" });
    const settled = expect(p).rejects.toThrow(/άργησε πολύ και διακόπηκε/);
    await vi.advanceTimersByTimeAsync(74_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(aborted).toBe(true);
    await settled;
  });

  it("does not call the API for files it cannot read, or without a key", async () => {
    const { fetchMock } = mockAnthropic(() => ok(message(JSON.stringify(GOOD))));
    await expect(readInvoiceWithAi({ bytes: JPG, kind: "heic" })).rejects.toThrow(/HEIC/);
    await expect(readInvoiceWithAi({ bytes: new Uint8Array(7 * 1024 * 1024 + 1), kind: "jpg" })).rejects.toThrow(/πολύ μεγάλη για ανάγνωση/);
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiConfigured()).toBe(false);
    expect((await invoiceFeatures()).ai).toBe(false);
    await expect(readInvoiceWithAi({ bytes: PDF, kind: "pdf" })).rejects.toThrow(/λείπει το ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(aiConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.ANTHROPIC_API_KEY = KEY;
    expect((await invoiceFeatures()).ai).toBe(true);
  });
});

describe("POST /api/invoices/read", () => {
  const form = (file?: { bytes: Uint8Array; name: string; type: string }, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    if (file) fd.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return new Request("https://pda.example.gr/api/invoices/read", { method: "POST", body: fd });
  };
  const pdf = { bytes: PDF, name: "scan.pdf", type: "application/pdf" };

  it("is admin only, returns suggestions and saves nothing", async () => {
    const { sent, fetchMock } = mockAnthropic(() => ok(message(JSON.stringify({ ...GOOD, supplier_afm: "094014201" }))));
    expect((await readRoute(form(pdf))).status).toBe(401);
    session.token = await signSession(waiter);
    expect((await readRoute(form(pdf))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    session.token = await signSession(admin);
    const { getDb, schema } = await import("@/db");
    const db = await getDb();
    const before = { entries: (await db.select().from(schema.financeEntries)).length, suppliers: (await db.select().from(schema.suppliers)).length };

    // Ό,τι άλλο στείλει ο browser μαζί με το αρχείο αγνοείται: στο API πάει μόνο το αρχείο και η οδηγία.
    const res = await readRoute(form(pdf, { note: "PRIVATE-NOTE-123", supplier: "PRIVATE-SUPPLIER" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { afm: string | null; check: string[]; warnings: string[]; totalCents: number } };
    expect(body.ok).toBe(true);
    // Το μοντέλο επέστρεψε το ΑΦΜ του ίδιου του καταστήματος (από τις Ρυθμίσεις): πιάνεται τοπικά.
    expect(body.data.afm).toBeNull();
    expect(body.data.check).toContain("afm");
    expect(body.data.totalCents).toBe(12400);
    expect(sent).toHaveLength(1);
    expect(sent[0].raw).not.toMatch(/PRIVATE|scan\.pdf|Nido|094014201|Κρυφή/);
    expect(sent[0].body.messages).toEqual(buildInvoiceRequest({ bytes: PDF, kind: "pdf" }).body.messages);

    const after = { entries: (await db.select().from(schema.financeEntries)).length, suppliers: (await db.select().from(schema.suppliers)).length };
    expect(after).toEqual(before);
  });

  it("answers JSON errors the form can show", async () => {
    session.token = await signSession(admin);
    const err = async (req: Request) => {
      const res = await readRoute(req);
      return { status: res.status, ...((await res.json()) as { ok: boolean; error: string }) };
    };
    const { fetchMock } = mockAnthropic(() => ok({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await err(form())).toMatchObject({ status: 400, ok: false, error: expect.stringMatching(/Δεν έφτασε αρχείο/) });
    expect(await err(form({ bytes: new TextEncoder().encode("GIF89a not allowed here, sorry"), name: "x.gif", type: "image/gif" }))).toMatchObject({ status: 400, error: expect.stringMatching(/Επιτρέπονται μόνο PDF/) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await err(form(pdf))).toMatchObject({ status: 502, ok: false, error: expect.stringMatching(/σφάλμα 529/) });
    delete process.env.ANTHROPIC_API_KEY;
    expect(await err(form(pdf))).toMatchObject({ status: 502, ok: false, error: expect.stringMatching(/ANTHROPIC_API_KEY/) });
    // Αίτημα που δεν είναι multipart.
    const notForm = new Request("https://pda.example.gr/api/invoices/read", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(await err(notForm)).toMatchObject({ status: 400, ok: false });
  });
});
