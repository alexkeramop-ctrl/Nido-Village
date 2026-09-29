"use client";
import { useState } from "react";
import { Field, Money } from "@/components/ui";
import { Section, TableWrap, useActionRunner } from "@/components/admin/common";
import { euroToInput, fmtDateOnly, fmtQty, parseDecimal } from "@/components/admin/format";
import { receiveGoodsAction } from "./actions";
import type { Ingredient, Supplier } from "./types";

type Receipt = {
  id: number;
  supplierName: string | null;
  docNumber: string | null;
  docDate: string;
  totalCents: number;
  notes: string | null;
  lines: { id: number; ingredientName: string; unitLabel: string; qty: number; unitCost: number }[];
};
type Line = { key: number; ingredientId: number; qty: string; unitCost: string };

let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, ingredientId: 0, qty: "", unitCost: "" });

export function ReceiveTab({ ingredients, suppliers, today, receipts }: { ingredients: Ingredient[]; suppliers: Supplier[]; today: string; receipts: Receipt[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [supplierId, setSupplierId] = useState<string>("");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const active = ingredients.filter((i) => i.active);
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const pickIngredient = (key: number, id: number) => {
    const ing = byId.get(id);
    update(key, { ingredientId: id, unitCost: ing && ing.cost > 0 ? euroToInput(ing.cost) : "" });
  };
  const lineTotalCents = (l: Line) => Math.round(parseDecimal(l.qty) * parseDecimal(l.unitCost) * 100);
  const totalCents = lines.reduce((n, l) => n + (l.ingredientId ? lineTotalCents(l) : 0), 0);
  const validLines = lines.filter((l) => l.ingredientId && parseDecimal(l.qty) > 0);

  const submit = () => {
    run(
      () =>
        receiveGoodsAction({
          supplierId: supplierId ? Number(supplierId) : null,
          docNumber,
          docDate,
          notes,
          lines: lines.map((l) => ({ ingredientId: l.ingredientId, qty: parseDecimal(l.qty), unitCost: l.unitCost })),
        }),
      {
        success: "Η παραλαβή καταχωρήθηκε και το απόθεμα ενημερώθηκε",
        onSuccess: () => {
          setLines([newLine()]);
          setDocNumber("");
          setNotes("");
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {toastElement}
      <Section title="Νέα παραλαβή">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Προμηθευτής">
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">—</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Αρ. παραστατικού">
              <input className="input" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="π.χ. ΤΔΑ-1234" />
            </Field>
            <Field label="Ημερομηνία">
              <input type="date" className="input num" value={docDate} onChange={(e) => setDocDate(e.target.value)} required />
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="table-grid">
              <thead>
                <tr>
                  <th className="w-1/2">Πρώτη ύλη</th>
                  <th>Ποσότητα</th>
                  <th>Κόστος/μον. (€)</th>
                  <th className="text-right">Σύνολο</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const ing = byId.get(l.ingredientId);
                  return (
                    <tr key={l.key}>
                      <td>
                        <select className="input" value={l.ingredientId || ""} onChange={(e) => pickIngredient(l.key, Number(e.target.value))} aria-label="Πρώτη ύλη">
                          <option value="">— Επίλεξε —</option>
                          {active.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.unitLabel})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <input className="input num" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} placeholder="0" aria-label="Ποσότητα" />
                          <span className="text-xs text-ink-3 whitespace-nowrap">{ing?.unitLabel ?? ""}</span>
                        </div>
                      </td>
                      <td>
                        <input className="input num" inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} placeholder="0,00" aria-label="Κόστος ανά μονάδα" />
                      </td>
                      <td className="text-right">
                        <Money cents={l.ingredientId ? lineTotalCents(l) : 0} />
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => remove(l.key)} disabled={lines.length === 1} aria-label="Αφαίρεση γραμμής">
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right font-semibold">
                    Σύνολο παραλαβής
                  </td>
                  <td className="text-right font-semibold">
                    <Money cents={totalCents} />
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
              + Γραμμή
            </button>
            <input className="input sm:max-w-md" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικά)" aria-label="Σημειώσεις" />
            <button type="submit" className="btn-primary btn-sm ml-auto" disabled={pending || !validLines.length}>
              {pending ? "Καταχώρηση…" : `Καταχώρηση παραλαβής (${validLines.length})`}
            </button>
          </div>
        </form>
      </Section>

      <Section title="Προηγούμενες παραλαβές" flush>
        {receipts.length ? (
          <ul className="divide-y divide-line">
            {receipts.map((r) => (
              <li key={r.id}>
                <details className="group">
                  <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 cursor-pointer list-none hover:bg-surface-3/50">
                    <span className="text-ink-3 num text-sm">#{r.id}</span>
                    <span className="num text-sm">{fmtDateOnly(r.docDate)}</span>
                    <span className="font-medium">{r.supplierName ?? "Χωρίς προμηθευτή"}</span>
                    {r.docNumber && <span className="text-sm text-ink-2 num">{r.docNumber}</span>}
                    <span className="text-sm text-ink-3">{r.lines.length} γραμμές</span>
                    <span className="ml-auto font-semibold">
                      <Money cents={r.totalCents} />
                    </span>
                    <span className="text-ink-3 transition-transform group-open:rotate-90">›</span>
                  </summary>
                  <div className="px-4 pb-3">
                    {r.notes && <p className="text-sm text-ink-2 mb-2">{r.notes}</p>}
                    <TableWrap>
                      <thead>
                        <tr>
                          <th>Πρώτη ύλη</th>
                          <th className="text-right">Ποσότητα</th>
                          <th className="text-right">Κόστος/μον.</th>
                          <th className="text-right">Σύνολο</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.lines.map((l) => (
                          <tr key={l.id}>
                            <td>{l.ingredientName}</td>
                            <td className="text-right num">
                              {fmtQty(l.qty)} {l.unitLabel}
                            </td>
                            <td className="text-right num">{euroToInput(l.unitCost)} €</td>
                            <td className="text-right">
                              <Money cents={Math.round(l.qty * l.unitCost * 100)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </TableWrap>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4 text-sm text-ink-3">Δεν έχουν καταχωρηθεί παραλαβές.</div>
        )}
      </Section>
    </div>
  );
}
