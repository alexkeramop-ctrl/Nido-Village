"use client";
import { useRef, useState } from "react";
import { Badge, Field, Money } from "@/components/ui";
import { Section, useActionRunner } from "@/components/admin/common";
import { DateGR } from "@/components/admin/date-gr";
import { euroToInput, fmtDateOnly, fmtQty, parseDecimal } from "@/components/admin/format";
import { guessFactor, type StockUnitLike } from "@/lib/invoice-match";
import type { InvoiceDraft } from "@/server/services/invoice-receipt";
import { receiveInvoiceAction } from "./actions";
import type { Ingredient, Supplier } from "./types";

type UiLine = {
  key: number;
  itemKey: string;
  description: string;
  code: string | null;
  unit: string | null;
  vatPct: number | null;
  source: "alias" | "name" | null;
  ingredientId: number;
  qty: string;
  price: string;
  factor: string;
  remember: boolean;
};

/** Μέγιστη ανάλυση που αξιοποιεί το μοντέλο (μακριά πλευρά / megapixels). Μεγαλύτερες φωτογραφίες απλώς κοστίζουν και αργούν. */
const MAX_EDGE = 2576;
const MAX_PIXELS = 3_700_000;

/** Σμικρύνει τη φωτογραφία του κινητού σε JPEG (συνήθως 300–900 KB). Τα PDF στέλνονται όπως είναι. */
async function prepareFile(f: File): Promise<File> {
  if (f.type === "application/pdf") return f;
  if (!f.type.startsWith("image/")) throw new Error("Δέχεται φωτογραφία ή PDF.");
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) throw new Error("Η φωτογραφία δεν ανοίγει σε αυτόν τον browser. Τράβηξέ τη ξανά ή στείλε PDF.");
  let scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  if (bmp.width * bmp.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Η φωτογραφία δεν μπόρεσε να ετοιμαστεί.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("Η φωτογραφία δεν μπόρεσε να ετοιμαστεί.");
  return new File([blob], "invoice.jpg", { type: "image/jpeg" });
}

const fmtNum = (n: number | null | undefined, d = 4) => (n === null || n === undefined ? "" : euroToInput(n, d));

let nextKey = 1;

/**
 * Ανάγνωση τιμολογίου: φωτογραφία ή PDF → προτεινόμενες γραμμές παραλαβής. Ο χρήστης ελέγχει πρώτη ύλη, ποσότητα, τιμή
 * και μετατροπή μονάδας (π.χ. 1 ΚΙΛ = 1000 γρ.) και καταχωρεί. Οι αντιστοιχίες μένουν για το επόμενο τιμολόγιο του ίδιου προμηθευτή.
 */
export function InvoiceImport({ enabled, ingredients, suppliers, today }: { enabled: boolean; ingredients: Ingredient[]; suppliers: Supplier[]; today: string }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [supplierChoice, setSupplierChoice] = useState<string>("");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState(today);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [lines, setLines] = useState<UiLine[]>([]);
  const active = ingredients.filter((i) => i.active);
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const reset = () => {
    setDraft(null);
    setLines([]);
    setAllowDuplicate(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const read = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    try {
      const file = await prepareFile(f);
      if (file.size > 8 * 1024 * 1024) throw new Error("Το αρχείο είναι πάνω από 8 MB.");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoices/read", { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as { ok: true; draft: InvoiceDraft } | { ok: false; error: string } | null;
      if (!body) throw new Error("Η ανάγνωση απέτυχε. Δοκίμασε ξανά.");
      if (!body.ok) throw new Error(body.error);
      const d = body.draft;
      if (!d.isInvoice) throw new Error("Το αρχείο δεν φαίνεται να είναι τιμολόγιο ή δελτίο αποστολής.");
      setDraft(d);
      setSupplierChoice(d.supplier.id ? String(d.supplier.id) : d.supplier.name ? "new" : "");
      setDocNumber(d.docNumber ?? "");
      setDocDate(d.docDate ?? today);
      setAllowDuplicate(false);
      setLines(
        d.lines.map((l) => ({
          key: nextKey++,
          itemKey: l.itemKey,
          description: l.description,
          code: l.code,
          unit: l.unit,
          vatPct: l.vatPct,
          source: l.source,
          ingredientId: l.ingredientId ?? 0,
          qty: fmtNum(l.quantity, 3),
          price: fmtNum(l.unitPriceNet, 4),
          factor: fmtNum(l.factor, 4),
          remember: true,
        })),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Η ανάγνωση απέτυχε.", "danger");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setReading(false);
    }
  };

  const update = (key: number, patch: Partial<UiLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pick = (l: UiLine, id: number) => {
    const ing = byId.get(id);
    const guess = ing ? guessFactor(l.unit, ing.unit as StockUnitLike, ing.packSize) : null;
    update(l.key, { ingredientId: id, factor: guess ? fmtNum(guess, 4) : l.factor && l.ingredientId === id ? l.factor : "" });
  };

  const chosen = lines.filter((l) => l.ingredientId > 0);
  const lineNet = (l: UiLine) => Math.round(parseDecimal(l.qty) * parseDecimal(l.price) * 100);
  const chosenCents = chosen.reduce((n, l) => n + lineNet(l), 0);
  const incomplete = chosen.filter((l) => !(parseDecimal(l.factor) > 0) || !(parseDecimal(l.qty) > 0) || l.price.trim() === "" || parseDecimal(l.price, -1) < 0);
  const blockedByDuplicate = Boolean(draft?.duplicateOf) && !allowDuplicate;

  const submit = () => {
    if (!draft) return;
    const supplierId = supplierChoice && supplierChoice !== "new" ? Number(supplierChoice) : null;
    run(
      () =>
        receiveInvoiceAction({
          supplierId,
          newSupplier: supplierChoice === "new" && draft.supplier.name ? { name: draft.supplier.name, vat: draft.supplier.vat } : null,
          docNumber,
          docDate,
          notes: draft.docType ?? "",
          allowDuplicate,
          lines: chosen.map((l) => ({
            itemKey: l.itemKey,
            ingredientId: l.ingredientId,
            quantity: parseDecimal(l.qty),
            unitPriceNet: parseDecimal(l.price),
            factor: parseDecimal(l.factor),
            remember: l.remember,
          })),
        }),
      {
        success: "Η παραλαβή καταχωρήθηκε από το τιμολόγιο. Το απόθεμα και η κοστολόγηση ενημερώθηκαν.",
        onSuccess: reset,
      },
    );
  };

  return (
    <Section
      title="Ανάγνωση τιμολογίου"
      actions={
        draft ? (
          <button type="button" className="btn-ghost btn-sm" onClick={reset} disabled={pending}>
            Ακύρωση
          </button>
        ) : null
      }
    >
      {toastElement}
      {!draft && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className={`btn-primary btn-sm ${!enabled || reading ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
            {reading ? "Διαβάζω το τιμολόγιο…" : "📄 Φωτογραφία ή PDF τιμολογίου"}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*,application/pdf"
              className="sr-only"
              disabled={!enabled || reading}
              data-testid="invoice-file"
              onChange={(e) => void read(e.target.files?.[0])}
            />
          </label>
          <p className="text-xs text-ink-3">
            {!enabled
              ? "Δεν είναι ενεργή: χρειάζεται το μυστικό ANTHROPIC_API_KEY στις ρυθμίσεις του Cloudflare. Μέχρι τότε συμπλήρωσε την παραλαβή από κάτω."
              : reading
                ? "Συνήθως 10–40 δευτερόλεπτα. Μην κλείσεις τη σελίδα."
                : "Βγάζει προμηθευτή, αριθμό, ημερομηνία και γραμμές. Τα ελέγχεις πριν την καταχώρηση· τίποτα δεν περνά μόνο του."}
          </p>
        </div>
      )}

      {draft && (
        <div className="space-y-4" data-testid="invoice-draft">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={draft.supplier.matchedBy === "vat" ? "Προμηθευτής (βρέθηκε από ΑΦΜ)" : "Προμηθευτής"}>
              <select className="input" value={supplierChoice} onChange={(e) => setSupplierChoice(e.target.value)}>
                <option value="">— Χωρίς προμηθευτή —</option>
                {!draft.supplier.id && draft.supplier.name && (
                  <option value="new">
                    + Νέος: {draft.supplier.name}
                    {draft.supplier.vat ? ` (ΑΦΜ ${draft.supplier.vat})` : ""}
                  </option>
                )}
                {suppliers
                  .filter((s) => s.active || String(s.id) === supplierChoice)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={draft.docType ? `Αρ. παραστατικού · ${draft.docType}` : "Αρ. παραστατικού"}>
              <input className="input" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
            </Field>
            <Field label="Ημερομηνία">
              <DateGR value={docDate} onChange={setDocDate} />
            </Field>
          </div>

          {draft.duplicateOf && (
            <div className="rounded-xl bg-danger-soft text-danger px-3 py-2 text-sm space-y-1">
              <p className="font-semibold">
                Αυτό το παραστατικό έχει ήδη καταχωρηθεί (παραλαβή #{draft.duplicateOf.id}, {fmtDateOnly(draft.duplicateOf.date)}).
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} /> Είναι άλλο παραστατικό: καταχώρησέ το κι αυτό
              </label>
            </div>
          )}
          {draft.warnings.length > 0 && (
            <ul className="rounded-xl bg-warn-soft text-warn px-3 py-2 text-sm list-disc pl-6 space-y-0.5" data-testid="invoice-warnings">
              {draft.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <ul className="space-y-2">
            {lines.map((l) => {
              const ing = byId.get(l.ingredientId);
              const factor = parseDecimal(l.factor);
              const qty = parseDecimal(l.qty);
              const price = parseDecimal(l.price);
              return (
                <li key={l.key} className={`rounded-2xl border p-3 space-y-2 ${l.ingredientId ? "border-line bg-white/60" : "border-dashed border-line bg-surface-3/40"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight">{l.description}</div>
                      <div className="text-xs text-ink-3 num">
                        {l.code ? `${l.code} · ` : ""}
                        {l.qty || "?"} {l.unit ?? ""} × {l.price || "?"} € {l.vatPct !== null ? `· ΦΠΑ ${l.vatPct}%` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.source === "alias" && <Badge tone="ok">Από προηγούμενο τιμολόγιο</Badge>}
                      {l.source === "name" && l.ingredientId > 0 && <Badge tone="warn">Πρόταση: έλεγξέ τη</Badge>}
                      <Money cents={l.ingredientId ? lineNet(l) : 0} className="font-semibold" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-2">
                    <select className="input" value={l.ingredientId || ""} onChange={(e) => pick(l, Number(e.target.value) || 0)} aria-label="Πρώτη ύλη">
                      <option value="">— Παράλειψη (δεν μπαίνει στην αποθήκη) —</option>
                      {active.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unitLabel})
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-ink-3">
                      <input className="input num" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} aria-label="Ποσότητα τιμολογίου" />
                      <span className="whitespace-nowrap">{l.unit ?? "μον."}</span>
                    </label>
                    <label className="flex items-center gap-1 text-xs text-ink-3">
                      <input className="input num" inputMode="decimal" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} aria-label="Τιμή μονάδας χωρίς ΦΠΑ" />
                      <span className="whitespace-nowrap">€ χ. ΦΠΑ</span>
                    </label>
                  </div>
                  {ing && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="flex items-center gap-1">
                        1 {l.unit || "μονάδα"} =
                        <input
                          className={`input num w-24! ${factor > 0 ? "" : "border-danger"}`}
                          inputMode="decimal"
                          value={l.factor}
                          onChange={(e) => update(l.key, { factor: e.target.value })}
                          aria-label="Μετατροπή μονάδας"
                          placeholder=";"
                        />
                        {ing.unitLabel}
                      </span>
                      {factor > 0 && qty > 0 && (
                        <span className="text-ink-2 num">
                          → {fmtQty(qty * factor)} {ing.unitLabel} · {euroToInput(price / factor, 4)} €/{ing.unitLabel}
                        </span>
                      )}
                      <label className="flex items-center gap-1 text-xs text-ink-3 ml-auto">
                        <input type="checkbox" checked={l.remember} onChange={(e) => update(l.key, { remember: e.target.checked })} /> Θυμήσου την αντιστοίχιση
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span>
              Στην αποθήκη: <Money cents={chosenCents} className="font-semibold" /> ({chosen.length}/{lines.length} γραμμές)
            </span>
            {draft.totalNet !== null && (
              <span className="text-ink-2">
                Καθαρό τιμολογίου: <Money cents={Math.round(draft.totalNet * 100)} />
              </span>
            )}
            {draft.totalGross !== null && (
              <span className="text-ink-3">
                Πληρωτέο με ΦΠΑ: <Money cents={Math.round(draft.totalGross * 100)} />
              </span>
            )}
            <button
              type="button"
              className="btn-primary btn-sm ml-auto"
              data-testid="invoice-submit"
              disabled={pending || !chosen.length || incomplete.length > 0 || blockedByDuplicate}
              onClick={submit}
            >
              {pending ? "Καταχώρηση…" : incomplete.length ? `Συμπλήρωσε ${incomplete.length} γραμμές` : `Καταχώρηση παραλαβής (${chosen.length})`}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}
