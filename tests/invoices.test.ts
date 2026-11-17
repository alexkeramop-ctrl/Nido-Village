import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { employeeByName, seeded } from "./helpers";
import {
  amountToCents,
  cleanAfm,
  fromNet,
  fromTotal,
  invoiceFileName,
  invoiceFolderPath,
  parseDocDate,
  sanitizeFilePart,
  sniffInvoiceFile,
  solveTotals,
  totalsDiff,
  validAfm,
  validIsoDate,
} from "@/lib/invoices";
import { deleteFinanceEntry, financeMonth, financeYear, findOrCreateSupplier, markFinanceEntryPaid, unpaidInvoices, upsertFinanceEntry } from "@/server/services/finance";
import { FINANCE_CSV_HEADER, financeCsv, financeCsvRows } from "@/components/admin/finance/csv";
import { DriveError, driveStatus } from "@/server/services/google-drive";
import { InvoiceAiError, aiConfigured } from "@/server/services/invoice-ai";
import { checkInvoiceFile, invoiceFeatures, readInvoiceFile, uploadInvoiceFile } from "@/server/services/invoice-files";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

let admin: { id: number };
beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("invoice totals", () => {
  it("computes the third amount from any two", () => {
    expect(solveTotals({ net: 10000, vat: 2400, total: null })).toMatchObject({ total: 12400, computed: "total" });
    expect(solveTotals({ net: 10000, vat: null, total: 12400 })).toMatchObject({ vat: 2400, computed: "vat" });
    expect(solveTotals({ net: null, vat: 2400, total: 12400 })).toMatchObject({ net: 10000, computed: "net" });
  });

  it("recomputes from the two fields the user typed last", () => {
    // Όλα συμπληρωμένα, ο χρήστης άλλαξε καθαρό και σύνολο: ο ΦΠΑ ακολουθεί.
    expect(solveTotals({ net: 5000, vat: 2400, total: 5650 }, ["net", "total"])).toMatchObject({ net: 5000, vat: 650, total: 5650, computed: "vat" });
    expect(solveTotals({ net: 5000, vat: 650, total: 1 }, ["net", "vat"])).toMatchObject({ total: 5650, computed: "total" });
  });

  it("changes nothing with fewer than two amounts or when all three are given", () => {
    expect(solveTotals({ net: 10000, vat: null, total: null })).toMatchObject({ net: 10000, vat: null, total: null, computed: null });
    expect(solveTotals({ net: null, vat: null, total: null }).computed).toBeNull();
    expect(solveTotals({ net: 10000, vat: 2400, total: 12000 })).toMatchObject({ total: 12000, computed: null });
  });

  it("reports the difference net + VAT - total", () => {
    expect(totalsDiff({ net: 10000, vat: 2400, total: 12400 })).toBe(0);
    expect(totalsDiff({ net: 10000, vat: 2400, total: 12000 })).toBe(400);
    expect(totalsDiff({ net: 10000, vat: 2300, total: 12400 })).toBe(-100);
    expect(totalsDiff({ net: 10000, vat: null, total: 12400 })).toBeNull();
  });

  it("applies a VAT rate from net or from total, always summing exactly", () => {
    expect(fromNet(10000, 24)).toEqual({ net: 10000, vat: 2400, total: 12400 });
    expect(fromTotal(12400, 24)).toEqual({ net: 10000, vat: 2400, total: 12400 });
    expect(fromTotal(1000, 13)).toEqual({ net: 885, vat: 115, total: 1000 });
    for (const [cents, rate] of [[999, 24], [1, 13], [123457, 6], [3333, 24]] as const) {
      const a = fromTotal(cents, rate);
      expect(a.net + a.vat).toBe(a.total);
      const b = fromNet(cents, rate);
      expect(b.net + b.vat).toBe(b.total);
    }
  });

  it("parses Greek and English amounts into cents", () => {
    expect(amountToCents("1.234,56")).toBe(123456);
    expect(amountToCents("1,234.56")).toBe(123456);
    expect(amountToCents("124,00")).toBe(12400);
    expect(amountToCents("124.5")).toBe(12450);
    expect(amountToCents("1.234")).toBe(123400);
    expect(amountToCents("12,5 €")).toBe(1250);
    expect(amountToCents(19.99)).toBe(1999);
    expect(amountToCents("-5,00")).toBe(-500);
    expect(amountToCents("")).toBeNull();
    expect(amountToCents("δώδεκα")).toBeNull();
    expect(amountToCents("12abc")).toBeNull();
    expect(amountToCents(null)).toBeNull();
    expect(amountToCents(Number.NaN)).toBeNull();
  });
});

describe("ΑΦΜ checksum", () => {
  it("accepts real tax numbers and rejects wrong check digits", () => {
    expect(validAfm("090000045")).toBe(true);
    expect(validAfm("094014201")).toBe(true);
    expect(validAfm("090000046")).toBe(false);
    expect(validAfm("123456789")).toBe(false);
  });

  it("needs exactly 9 digits and refuses the all-zero number", () => {
    expect(validAfm("09000004")).toBe(false);
    expect(validAfm("0900000455")).toBe(false);
    expect(validAfm("000000000")).toBe(false);
    expect(validAfm("09000004A")).toBe(false);
    expect(validAfm("")).toBe(false);
    expect(validAfm(null)).toBe(false);
  });

  it("cleans prefixes and separators before checking", () => {
    expect(cleanAfm("EL 090000045")).toBe("090000045");
    expect(cleanAfm("GR090-000-045")).toBe("090000045");
    expect(validAfm(cleanAfm(" EL090000045 "))).toBe(true);
  });
});

describe("invoice dates and files", () => {
  it("validates and parses document dates", () => {
    expect(validIsoDate("2026-11-05")).toBe(true);
    expect(validIsoDate("2026-02-31")).toBe(false);
    expect(validIsoDate("05/11/2026")).toBe(false);
    expect(parseDocDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDocDate("5.11.2026")).toBe("2026-11-05");
    expect(parseDocDate("2026-11-05")).toBe("2026-11-05");
    expect(parseDocDate("31/02/2026")).toBeNull();
    expect(parseDocDate("yesterday")).toBeNull();
  });

  it("recognises allowed files from their bytes, not their name", () => {
    expect(sniffInvoiceFile(PDF)).toBe("pdf");
    expect(sniffInvoiceFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]))).toBe("jpg");
    expect(sniffInvoiceFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe("png");
    expect(sniffInvoiceFile(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("webp");
    expect(sniffInvoiceFile(new TextEncoder().encode("\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000"))).toBe("heic");
    expect(sniffInvoiceFile(new TextEncoder().encode("MZ this is an executable, not an invoice"))).toBeNull();
    expect(sniffInvoiceFile(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(() => checkInvoiceFile(new Uint8Array(0))).toThrow(/Δεν έφτασε αρχείο/);
    expect(() => checkInvoiceFile(new TextEncoder().encode("plain text, long enough to sniff"))).toThrow(/Επιτρέπονται μόνο PDF/);
    expect(() => checkInvoiceFile(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow(/10 MB/);
  });

  it("builds a sanitised file name and the year/month folder path", () => {
    expect(invoiceFileName({ date: "2026-11-05", supplier: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ", docNumber: "ΤΔΑ 1532", ext: "pdf" })).toBe("2026-11-05 ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ ΤΔΑ 1532.pdf");
    expect(invoiceFileName({ date: "2026-11-05", supplier: '  ../../etc/passwd: "x" <y>|z?*  ', docNumber: "A/123\\4", ext: "jpg" })).toBe("2026-11-05 etc-passwd- -x- -y--z A-123-4.jpg");
    expect(invoiceFileName({ date: "2026-11-05", supplier: "", docNumber: null, ext: "png" })).toBe("2026-11-05 Χωρίς προμηθευτή.png");
    expect(invoiceFileName({ date: "2026-11-05", supplier: "Line\nbreak\tand\u0000null", docNumber: "", ext: "webp" })).toBe("2026-11-05 Line break and null.webp");
    const name = invoiceFileName({ date: "2026-11-05", supplier: "Α".repeat(300), docNumber: "9".repeat(300), ext: "heic" });
    expect(name.length).toBeLessThanOrEqual(10 + 1 + 60 + 1 + 40 + 5);
    expect(name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
    expect(sanitizeFilePart("...hidden.. ")).toBe("hidden");
    expect(invoiceFolderPath("2026-03-09")).toEqual(["Nido Τιμολόγια", "2026", "03"]);
    expect(() => invoiceFolderPath("2026-13-01")).toThrow();
  });
});

describe("supplier invoices in finance", () => {
  it("creates the supplier from name + ΑΦΜ and reuses it by ΑΦΜ", async () => {
    const row = await upsertFinanceEntry(
      {
        kind: "expense",
        date: "2031-05-10",
        category: "Εξοπλισμός",
        amountCents: 12400,
        vatCents: 2400,
        netCents: 10000,
        docNumber: "ΤΔΑ 1532",
        newSupplier: { name: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ", vatNumber: "090000045" },
        paid: false,
        dueDate: "2031-06-10",
      },
      admin.id,
    );
    expect(row.supplierId).toBeTruthy();
    expect(row).toMatchObject({ netCents: 10000, vatCents: 2400, amountCents: 12400, paid: false, dueDate: "2031-06-10", paidAt: null, docNumber: "ΤΔΑ 1532" });
    const db = await getDb();
    const sup = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, row.supplierId!) });
    expect(sup).toMatchObject({ name: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ", vatNumber: "090000045" });

    // Ίδιο ΑΦΜ με άλλη γραφή της επωνυμίας: ο ίδιος προμηθευτής, όχι δεύτερος.
    const again = await findOrCreateSupplier({ name: "Κάβα Παπαδόπουλος", vatNumber: "EL 090000045" }, admin.id);
    expect(again).toMatchObject({ id: row.supplierId, created: false });
    // Ίδιο όνομα (χωρίς ΑΦΜ) με υπάρχοντα προμηθευτή του seed: συμπληρώνεται το ΑΦΜ του.
    const seeded = await findOrCreateSupplier({ name: "  μάνος ποτά αε ", vatNumber: "094014201" }, admin.id);
    expect(seeded.created).toBe(false);
    expect((await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, seeded.id) }))?.vatNumber).toBe("094014201");

    await expect(findOrCreateSupplier({ name: "Λάθος ΑΦΜ ΕΠΕ", vatNumber: "123456789" }, admin.id)).rejects.toThrow(/ΑΦΜ/);
    await expect(findOrCreateSupplier({ name: "   " }, admin.id)).rejects.toThrow(/επωνυμία/);
    await deleteFinanceEntry(row.id, admin.id);
  });

  it("summarises unpaid invoices of all months and marks one as paid", async () => {
    const before = await unpaidInvoices("2031-07-15");
    expect(before).toMatchObject({ count: 0, totalCents: 0, overdueCount: 0 });

    const mk = (date: string, amountCents: number, extra: Partial<Parameters<typeof upsertFinanceEntry>[0]> = {}) =>
      upsertFinanceEntry({ kind: "expense", date, category: "Ρεύμα", amountCents, vatCents: 0, paid: false, ...extra }, admin.id);
    const a = await mk("2031-05-20", 10000, { dueDate: "2031-06-20", docNumber: "A-1" });
    const b = await mk("2031-06-03", 25050, { dueDate: "2031-08-01" });
    const c = await mk("2031-07-01", 990);
    const paid = await upsertFinanceEntry({ kind: "expense", date: "2031-06-04", category: "Νερό", amountCents: 5000, paid: true }, admin.id);
    // Τα έσοδα δεν «οφείλονται» ποτέ, ακόμη κι αν ζητηθεί.
    const income = await upsertFinanceEntry({ kind: "income", date: "2031-06-05", category: "Χορηγίες", amountCents: 7000, paid: false, dueDate: "2031-07-01" }, admin.id);
    expect(income).toMatchObject({ paid: true, dueDate: null, paidAt: "2031-06-05" });
    expect(paid).toMatchObject({ paid: true, paidAt: "2031-06-04", dueDate: null });

    const sum = await unpaidInvoices("2031-07-15");
    expect(sum.count).toBe(3);
    expect(sum.totalCents).toBe(10000 + 25050 + 990);
    expect(sum.overdueCount).toBe(1);
    expect(sum.overdueCents).toBe(10000);
    expect(sum.entries.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(sum.entries.every((e) => !e.paid)).toBe(true);

    const juneBefore = await financeMonth("2031-06");
    const done = await markFinanceEntryPaid(b.id, { method: "cash", paidAt: "2031-07-14" }, admin.id);
    expect(done).toMatchObject({ paid: true, paidAt: "2031-07-14", method: "cash", date: "2031-06-03" });
    await expect(markFinanceEntryPaid(b.id, { method: "cash" }, admin.id)).rejects.toThrow(/ήδη πληρωμένο/);
    await expect(markFinanceEntryPaid(c.id, { method: "bitcoin" as never }, admin.id)).rejects.toThrow(/τρόπος πληρωμής/);
    await expect(markFinanceEntryPaid(c.id, { method: "bank", paidAt: "14/07/2031" }, admin.id)).rejects.toThrow(/ημερομηνία/);
    await expect(markFinanceEntryPaid(987654, { method: "bank" }, admin.id)).rejects.toThrow(/δεν βρέθηκε/);

    const after = await unpaidInvoices("2031-07-15");
    expect(after.count).toBe(2);
    expect(after.totalCents).toBe(10000 + 990);

    // Δεδουλευμένη βάση: η πληρωμή τον Ιούλιο δεν μετακινεί το έξοδο από τον Ιούνιο (ημερομηνία παραστατικού).
    const juneAfter = await financeMonth("2031-06");
    expect(juneAfter.expense).toEqual(juneBefore.expense);
    expect(juneAfter.net).toBe(juneBefore.net);
    expect(juneAfter.expense.manualTotal).toBe(25050 + 5000);
    const july = await financeMonth("2031-07");
    expect(july.expense.manualTotal).toBe(990);

    // Χωρίς ημερομηνία: σήμερα (ώρα Αθήνας).
    const today = await markFinanceEntryPaid(c.id, { method: "bank" }, admin.id);
    expect(today.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const audits = await (await getDb()).query.auditLog.findMany({ where: eq(schema.auditLog.action, "finance_mark_paid") });
    expect(audits.map((x) => x.entityId).sort()).toEqual([b.id, c.id].sort());
    for (const id of [a.id, b.id, c.id, paid.id, income.id]) await deleteFinanceEntry(id, admin.id);
  });

  it("keeps the month figures of old rows unchanged (rows written before the invoice columns)", async () => {
    const db = await getDb();
    // Όπως τις έγραφε ο παλιός κώδικας: μόνο οι αρχικές στήλες.
    const [oldExpense] = await db.insert(schema.financeEntries).values({ kind: "expense", date: "2030-02-10", category: "Ενοίκιο", description: "Ενοίκιο Φεβρουαρίου", amountCents: 80000, vatCents: 0, method: "bank" }).returning();
    const [oldIncome] = await db.insert(schema.financeEntries).values({ kind: "income", date: "2030-02-12", category: "Χορηγίες", amountCents: 30000, vatCents: 5806, method: "cash", docNumber: "ΑΠΥ 7" }).returning();
    expect(oldExpense).toMatchObject({ paid: true, netCents: null, dueDate: null, paidAt: null, attachmentUrl: null, attachmentName: null, attachmentFileId: null });

    const m = await financeMonth("2030-02");
    expect(m.income).toMatchObject({ posTotal: 0, manualTotal: 30000, total: 30000 });
    expect(m.expense).toMatchObject({ purchases: 0, manualTotal: 80000, total: 80000 });
    expect(m.net).toBe(-50000);
    expect(m.expense.manual).toEqual([{ category: "Ενοίκιο", cents: 80000 }]);
    expect(m.days.find((d) => d.date === "2030-02-10")).toEqual({ date: "2030-02-10", income: 0, expense: 80000 });
    expect(m.days.find((d) => d.date === "2030-02-12")).toEqual({ date: "2030-02-12", income: 30000, expense: 0 });
    expect(m.entries).toHaveLength(2);
    expect(m.entries[0]).toMatchObject({ id: oldExpense.id, paid: true, netCents: null, paidAt: null, attachmentUrl: null, hasDriveFile: false, supplierName: null });
    // Οι παλιές κινήσεις δεν εμφανίζονται ποτέ ως οφειλές.
    expect((await unpaidInvoices("2030-03-01")).entries.some((e) => e.id === oldExpense.id || e.id === oldIncome.id)).toBe(false);

    // Ένα απλήρωτο τιμολόγιο μετράει στον μήνα του παραστατικού του, είτε πληρωθεί είτε όχι.
    const inv = await upsertFinanceEntry({ kind: "expense", date: "2030-02-20", category: "Ρεύμα", amountCents: 12400, vatCents: 2400, netCents: 10000, paid: false }, admin.id);
    const withInvoice = await financeMonth("2030-02");
    expect(withInvoice.expense.total).toBe(92400);
    expect(withInvoice.net).toBe(-62400);
    await markFinanceEntryPaid(inv.id, { method: "bank", paidAt: "2030-04-02" }, admin.id);
    expect((await financeMonth("2030-02")).expense.total).toBe(92400);
    expect((await financeMonth("2030-04")).expense.total).toBe(0);
    const year = await financeYear("2030-04");
    expect(year.find((x) => x.month === "2030-02")).toEqual({ month: "2030-02", income: 30000, expense: 92400 });
    expect(year.find((x) => x.month === "2030-04")).toEqual({ month: "2030-04", income: 0, expense: 0 });

    // Επεξεργασία παλιάς κίνησης χωρίς αλλαγή συνημμένου: μένει πληρωμένη.
    const edited = await upsertFinanceEntry({ id: oldExpense.id, kind: "expense", date: "2030-02-10", category: "Ενοίκιο", amountCents: 80000 }, admin.id);
    expect(edited).toMatchObject({ paid: true, paidAt: "2030-02-10", attachmentUrl: null });
  });

  it("validates amounts, dates and attachments", async () => {
    const base = { kind: "expense" as const, date: "2031-09-01", category: "Άλλο", amountCents: 1000 };
    await expect(upsertFinanceEntry({ ...base, date: "2031-02-30" }, admin.id)).rejects.toThrow(/ημερομηνία/);
    await expect(upsertFinanceEntry({ ...base, netCents: 2000 }, admin.id)).rejects.toThrow(/καθαρή αξία/);
    await expect(upsertFinanceEntry({ ...base, vatCents: 2000 }, admin.id)).rejects.toThrow(/ΦΠΑ/);
    await expect(upsertFinanceEntry({ ...base, paid: false, dueDate: "soon" }, admin.id)).rejects.toThrow(/ημερομηνία πληρωμής/);
    await expect(upsertFinanceEntry({ ...base, attachment: { fileId: "f1", url: "https://evil.example/x", name: "x.pdf" } }, admin.id)).rejects.toThrow(/συνημμένο/);
    await expect(upsertFinanceEntry({ ...base, attachment: { fileId: "", url: "https://drive.google.com/file/d/1/view", name: "x.pdf" } }, admin.id)).rejects.toThrow(/συνημμένο/);

    const row = await upsertFinanceEntry({ ...base, attachment: { fileId: "file-1", url: "https://drive.google.com/file/d/file-1/view", name: "2031-09-01 Χ.pdf" } }, admin.id);
    expect(row).toMatchObject({ attachmentFileId: "file-1", attachmentUrl: "https://drive.google.com/file/d/file-1/view", attachmentName: "2031-09-01 Χ.pdf" });
    // undefined = μην αγγίξεις το συνημμένο· null = αφαίρεσέ το.
    const kept = await upsertFinanceEntry({ ...base, id: row.id, amountCents: 1500 }, admin.id);
    expect(kept).toMatchObject({ amountCents: 1500, attachmentFileId: "file-1" });
    const removed = await upsertFinanceEntry({ ...base, id: row.id, attachment: null }, admin.id);
    expect(removed).toMatchObject({ attachmentFileId: null, attachmentUrl: null, attachmentName: null });
    await deleteFinanceEntry(row.id, admin.id);
  });

  it("exports the new invoice columns in the CSV", async () => {
    const inv = await upsertFinanceEntry(
      {
        kind: "expense",
        date: "2032-01-15",
        category: "Εξοπλισμός",
        description: "Ψυγείο",
        amountCents: 124000,
        vatCents: 24000,
        netCents: 100000,
        docNumber: "ΤΔΑ 77",
        newSupplier: { name: "ΨΥΚΤΙΚΑ ΒΟΡΕΙΟΥ ΕΛΛΑΔΟΣ", vatNumber: "801234560" },
        paid: false,
        dueDate: "2032-02-15",
        attachment: { fileId: "f77", url: "https://drive.google.com/file/d/f77/view", name: "2032-01-15 ΨΥΚΤΙΚΑ ΤΔΑ 77.pdf" },
      },
      admin.id,
    );
    await upsertFinanceEntry({ kind: "expense", date: "2032-01-20", category: "Νερό", amountCents: 3000, paid: true, paidAt: "2032-01-25", method: "cash" }, admin.id);
    await upsertFinanceEntry({ kind: "income", date: "2032-01-21", category: "Χορηγίες", amountCents: 50000 }, admin.id);
    const m = await financeMonth("2032-01");
    const rows = financeCsvRows(m);
    expect(rows[0]).toEqual(FINANCE_CSV_HEADER);
    expect(FINANCE_CSV_HEADER.slice(0, 8)).toEqual(["Ημερομηνία", "Τύπος", "Κατηγορία", "Περιγραφή", "Τρόπος", "Παραστατικό", "Ποσό", "ΦΠΑ"]);
    expect(FINANCE_CSV_HEADER.slice(8)).toEqual(["Καθαρό", "Προμηθευτής", "ΑΦΜ προμηθευτή", "Κατάσταση", "Λήξη πληρωμής", "Ημ/νία πληρωμής", "Αρχείο"]);
    expect(rows.every((r) => r.length === FINANCE_CSV_HEADER.length)).toBe(true);
    const col = (name: string) => FINANCE_CSV_HEADER.indexOf(name);
    const invRow = rows.find((r) => r[col("Παραστατικό")] === "ΤΔΑ 77")!;
    expect(invRow[col("Ποσό")]).toBe("1240,00");
    expect(invRow[col("ΦΠΑ")]).toBe("240,00");
    expect(invRow[col("Καθαρό")]).toBe("1000,00");
    expect(invRow[col("Προμηθευτής")]).toBe("ΨΥΚΤΙΚΑ ΒΟΡΕΙΟΥ ΕΛΛΑΔΟΣ");
    expect(invRow[col("ΑΦΜ προμηθευτή")]).toBe("801234560");
    expect(invRow[col("Κατάσταση")]).toBe("Οφείλεται");
    expect(invRow[col("Λήξη πληρωμής")]).toBe("2032-02-15");
    expect(invRow[col("Ημ/νία πληρωμής")]).toBe("");
    expect(invRow[col("Αρχείο")]).toBe("https://drive.google.com/file/d/f77/view");
    const paidRow = rows.find((r) => r[col("Κατηγορία")] === "Νερό")!;
    expect(paidRow[col("Κατάσταση")]).toBe("Πληρωμένο");
    expect(paidRow[col("Ημ/νία πληρωμής")]).toBe("2032-01-25");
    expect(paidRow[col("Καθαρό")]).toBe("");
    const incomeRow = rows.find((r) => r[col("Τύπος")] === "Έσοδο")!;
    expect(incomeRow[col("Κατάσταση")]).toBe("");
    const csv = financeCsv(m);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toContain('"Καθαρό";"Προμηθευτής";"ΑΦΜ προμηθευτή";"Κατάσταση";"Λήξη πληρωμής";"Ημ/νία πληρωμής";"Αρχείο"');
    await deleteFinanceEntry(inv.id, admin.id);
  });
});

describe("without Google Drive and without the AI key", () => {
  it("reports both features off and never touches the network", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await invoiceFeatures()).toEqual({ drive: false, driveNeedsReconnect: false, ai: false });
    expect(await driveStatus()).toEqual({ configured: false, connected: false, needsReconnect: false, email: null, connectedAt: null });
    expect(aiConfigured()).toBe(false);

    // Η καταχώρηση τιμολογίου δουλεύει κανονικά χωρίς αρχείο.
    const row = await upsertFinanceEntry(
      { kind: "expense", date: "2033-03-03", category: "Συντήρηση & επισκευές", amountCents: 6200, vatCents: 1200, netCents: 5000, docNumber: "ΑΠΥ 12", newSupplier: { name: "Υδραυλικός Γιάννης" }, paid: true },
      admin.id,
    );
    expect(row).toMatchObject({ amountCents: 6200, paid: true, attachmentUrl: null, attachmentFileId: null });
    expect((await financeMonth("2033-03")).expense.manualTotal).toBe(6200);

    // Ανέβασμα και ανάγνωση αρνούνται με καθαρό ελληνικό μήνυμα, χωρίς αίτημα προς τα έξω.
    const up = uploadInvoiceFile({ bytes: PDF, date: "2033-03-03", supplier: "Υδραυλικός Γιάννης", docNumber: "ΑΠΥ 12" }, admin.id);
    await expect(up).rejects.toBeInstanceOf(DriveError);
    await expect(up).rejects.toThrow(/Google Drive δεν έχει ρυθμιστεί/);
    const read = readInvoiceFile({ bytes: PDF });
    await expect(read).rejects.toBeInstanceOf(InvoiceAiError);
    await expect(read).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
    await deleteFinanceEntry(row.id, admin.id);
  });

  it("with keys but no connected account, upload asks to connect (still no network)", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await invoiceFeatures()).toMatchObject({ drive: false });
      expect(await driveStatus()).toMatchObject({ configured: true, connected: false });
      await expect(uploadInvoiceFile({ bytes: PDF, date: "2033-03-03" }, admin.id)).rejects.toThrow(/δεν είναι συνδεδεμένο/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
  });
});
