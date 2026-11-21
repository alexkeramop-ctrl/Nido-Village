/**
 * Από ανάγνωση τιμολογίου σε παραλαβή αποθήκης.
 * 1) draftFromExtraction: βρίσκει τον προμηθευτή (ΑΦΜ/όνομα), προτείνει πρώτη ύλη και συντελεστή μονάδας για κάθε γραμμή
 *    (πρώτα από όσα θυμάται από προηγούμενα τιμολόγια, μετά από το όνομα) και ελέγχει αθροίσματα και διπλή καταχώρηση.
 * 2) receiveInvoice: ο χρήστης έχει ελέγξει τις γραμμές· γίνεται η παραλαβή (απόθεμα + κόστος) και αποθηκεύονται οι αντιστοιχίες.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { cleanVat, convertLine, guessFactor, nameScore, normalizeItemKey, suggestIngredient, type StockUnitLike } from "@/lib/invoice-match";
import { num, qty4 } from "@/server/money";
import { receiveGoods, upsertSupplier } from "./inventory";
import type { ExtractedInvoice } from "./invoice-reader";

export type InvoiceDraftLine = {
  index: number;
  itemKey: string;
  code: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceNet: number | null;
  lineNet: number | null;
  vatPct: number | null;
  /** Προτεινόμενη πρώτη ύλη (null = καμία). */
  ingredientId: number | null;
  /** Πόσες μονάδες της πρώτης ύλης είναι 1 μονάδα του τιμολογίου (null = άγνωστο, το συμπληρώνει ο χρήστης). */
  factor: number | null;
  /** Από πού ήρθε η πρόταση: θυμάται από προηγούμενο τιμολόγιο ή από ομοιότητα ονόματος. */
  source: "alias" | "name" | null;
};

export type InvoiceDraft = {
  isInvoice: boolean;
  supplier: { id: number | null; name: string | null; vat: string | null; matchedBy: "vat" | "name" | null };
  docType: string | null;
  docNumber: string | null;
  /** YYYY-MM-DD ή null. */
  docDate: string | null;
  lines: InvoiceDraftLine[];
  totalNet: number | null;
  totalVat: number | null;
  totalGross: number | null;
  /** Άθροισμα καθαρής αξίας γραμμών, για έλεγχο με το καθαρό σύνολο του τιμολογίου. */
  linesNet: number;
  warnings: string[];
  /** Έχει ήδη καταχωρηθεί παραλαβή με τον ίδιο προμηθευτή και αριθμό. */
  duplicateOf: { id: number; date: string } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const normName = (s: string) => normalizeItemKey(s).replace(/\b(ae|επε|ike|ικε|οε|ee|εε|μον|μονοπροσωπη)\b/g, "").replace(/\s+/g, " ").trim();

async function findDuplicate(supplierId: number | null, docNumber: string | null) {
  if (!supplierId || !docNumber?.trim()) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.goodsReceipts.id, date: schema.goodsReceipts.docDate })
    .from(schema.goodsReceipts)
    .where(and(eq(schema.goodsReceipts.supplierId, supplierId), sql`upper(trim(${schema.goodsReceipts.docNumber})) = ${docNumber.trim().toUpperCase()}`))
    .limit(1);
  return row ? { id: row.id, date: row.date.toISOString() } : null;
}

export async function draftFromExtraction(x: ExtractedInvoice): Promise<InvoiceDraft> {
  const db = await getDb();
  const [suppliers, ingredients] = await Promise.all([
    db.query.suppliers.findMany(),
    db.query.ingredients.findMany({ where: eq(schema.ingredients.active, true) }),
  ]);
  const vat = cleanVat(x.supplier_vat);
  let supplier: InvoiceDraft["supplier"] = { id: null, name: x.supplier_name?.trim() || null, vat: vat || null, matchedBy: null };
  const byVat = vat ? suppliers.find((s) => cleanVat(s.vatNumber) === vat) : undefined;
  const byName =
    !byVat && supplier.name
      ? suppliers.find((s) => normName(s.name) === normName(supplier.name!) || (nameScore(supplier.name!, s.name) >= 0.8 && nameScore(s.name, supplier.name!) >= 0.8))
      : undefined;
  const found = byVat ?? byName;
  if (found) supplier = { id: found.id, name: found.name, vat: cleanVat(found.vatNumber) || vat || null, matchedBy: byVat ? "vat" : "name" };

  const keys = x.lines.map((l) => normalizeItemKey(l.description, l.code));
  const aliases = keys.length
    ? await db.select().from(schema.invoiceItemAliases).where(inArray(schema.invoiceItemAliases.itemKey, [...new Set(keys)]))
    : [];
  const active = new Map(ingredients.map((i) => [i.id, i]));

  const lines: InvoiceDraftLine[] = x.lines.map((l, index) => {
    const itemKey = keys[index];
    const unitPriceNet = l.unit_price_net ?? (l.line_net !== null && l.quantity ? round2(l.line_net / l.quantity) : null);
    // Πρώτα ό,τι θυμάται για αυτόν τον προμηθευτή, μετά από οποιονδήποτε (ίδια περιγραφή = ίδιο είδος).
    const alias =
      aliases.find((a) => a.itemKey === itemKey && supplier.id !== null && a.supplierId === supplier.id && active.has(a.ingredientId)) ??
      aliases.find((a) => a.itemKey === itemKey && active.has(a.ingredientId));
    const base = { index, itemKey, code: l.code, description: l.description, quantity: l.quantity, unit: l.unit, unitPriceNet, lineNet: l.line_net, vatPct: l.vat_pct };
    if (alias) return { ...base, ingredientId: alias.ingredientId, factor: num(alias.factor), source: "alias" as const };
    const ing = suggestIngredient(l.description, ingredients);
    if (!ing) return { ...base, ingredientId: null, factor: null, source: null };
    return { ...base, ingredientId: ing.id, factor: guessFactor(l.unit, ing.unit as StockUnitLike, ing.packSize ? num(ing.packSize) : null), source: "name" as const };
  });

  const linesNet = round2(lines.reduce((n, l) => n + (l.lineNet ?? (l.unitPriceNet ?? 0) * l.quantity), 0));
  const warnings = [...x.warnings];
  if (x.total_net !== null && Math.abs(linesNet - x.total_net) > 0.05) {
    warnings.push(`Το άθροισμα των γραμμών (${linesNet.toFixed(2)} €) δεν συμφωνεί με το καθαρό σύνολο του τιμολογίου (${x.total_net.toFixed(2)} €). Έλεγξε ποσότητες και τιμές.`);
  }
  if (lines.some((l) => l.unitPriceNet === null)) warnings.push("Κάποιες γραμμές δεν έχουν τιμή. Συμπλήρωσέ τες πριν την καταχώρηση.");
  const docDate = x.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(x.doc_date) ? x.doc_date : null;
  return {
    isInvoice: x.is_invoice,
    supplier,
    docType: x.doc_type,
    docNumber: x.doc_number?.trim() || null,
    docDate,
    lines,
    totalNet: x.total_net,
    totalVat: x.total_vat,
    totalGross: x.total_gross,
    linesNet,
    warnings,
    duplicateOf: await findDuplicate(supplier.id, x.doc_number),
  };
}

export type ReceiveInvoiceInput = {
  supplierId: number | null;
  /** Νέος προμηθευτής από το τιμολόγιο (όταν δεν βρέθηκε). */
  newSupplier?: { name: string; vat: string | null } | null;
  docNumber: string | null;
  docDate: Date;
  notes?: string | null;
  /** Επιτρέπει καταχώρηση ενώ υπάρχει ήδη παραλαβή με ίδιο προμηθευτή και αριθμό. */
  allowDuplicate?: boolean;
  lines: { itemKey: string; ingredientId: number; quantity: number; unitPriceNet: number; factor: number; remember: boolean }[];
};

export async function receiveInvoice(input: ReceiveInvoiceInput, employeeId: number) {
  const db = await getDb();
  const lines = input.lines.filter((l) => l.ingredientId > 0 && l.quantity > 0);
  if (!lines.length) throw new Error("Διάλεξε πρώτη ύλη τουλάχιστον σε μία γραμμή");
  for (const l of lines) {
    if (!(l.factor > 0) || l.factor > 100000) throw new Error("Συμπλήρωσε σωστά τη μετατροπή μονάδας σε όλες τις γραμμές");
    if (!(l.unitPriceNet >= 0) || l.unitPriceNet > 100000) throw new Error("Συμπλήρωσε την τιμή σε όλες τις γραμμές");
    if (l.quantity > 100000) throw new Error("Η ποσότητα είναι υπερβολικά μεγάλη");
  }
  const ids = [...new Set(lines.map((l) => l.ingredientId))];
  const found = await db.select({ id: schema.ingredients.id }).from(schema.ingredients).where(inArray(schema.ingredients.id, ids));
  if (found.length !== ids.length) throw new Error("Κάποια πρώτη ύλη δεν βρέθηκε. Ανανέωσε τη σελίδα.");

  let supplierId = input.supplierId;
  if (supplierId) {
    const s = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, supplierId) });
    if (!s) throw new Error("Ο προμηθευτής δεν βρέθηκε");
  } else if (input.newSupplier?.name.trim()) {
    const vat = cleanVat(input.newSupplier.vat);
    const existing = vat ? (await db.query.suppliers.findMany()).find((s) => cleanVat(s.vatNumber) === vat) : undefined;
    supplierId = existing ? existing.id : (await upsertSupplier({ name: input.newSupplier.name.slice(0, 120), vatNumber: vat || null })).id;
  }
  const dup = await findDuplicate(supplierId, input.docNumber);
  if (dup && !input.allowDuplicate) throw new Error(`Αυτό το παραστατικό έχει ήδη καταχωρηθεί (παραλαβή #${dup.id}).`);

  const receipt = await receiveGoods(
    {
      supplierId,
      docNumber: input.docNumber?.trim().slice(0, 60) || null,
      docDate: input.docDate,
      notes: [input.notes?.trim(), "Από ανάγνωση τιμολογίου"].filter(Boolean).join(" · ").slice(0, 300),
      lines: lines.map((l) => ({ ingredientId: l.ingredientId, ...convertLine(l.quantity, l.unitPriceNet, l.factor) })),
    },
    employeeId,
  );

  // Θυμάται «αυτή η περιγραφή του προμηθευτή = αυτή η πρώτη ύλη, με αυτόν τον συντελεστή» για το επόμενο τιμολόγιο.
  const remember = supplierId ? lines.filter((l) => l.remember && l.itemKey.trim()) : [];
  for (const l of remember) {
    await db
      .insert(schema.invoiceItemAliases)
      .values({ supplierId, itemKey: l.itemKey.slice(0, 200), ingredientId: l.ingredientId, factor: qty4(l.factor) })
      .onConflictDoUpdate({
        target: [schema.invoiceItemAliases.supplierId, schema.invoiceItemAliases.itemKey],
        set: { ingredientId: l.ingredientId, factor: qty4(l.factor), updatedAt: new Date() },
      });
  }
  await audit(db, employeeId, "invoice_receipt", "goods_receipt", receipt.id, { lines: lines.length, remembered: remember.length });
  return { id: receipt.id, totalCents: receipt.totalCents, supplierId };
}
