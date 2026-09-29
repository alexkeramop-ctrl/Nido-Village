"use client";
import { useMemo, useState } from "react";
import { Badge, EmptyState, Modal, Money } from "@/components/ui";
import { InfoBox, PageHeader, Section, TableWrap, useActionRunner } from "@/components/admin/common";
import { fmtQty, parseDecimal } from "@/components/admin/format";
import { setRecipeAction } from "./actions";

type Line = { ingredientId: number; qty: number };
type Product = { id: number; name: string; categoryName: string; categorySort: number; priceCents: number; costCents: number; active: boolean; lines: Line[] };
type Modifier = { id: number; name: string; groupName: string; priceDeltaCents: number; active: boolean; lines: Line[] };
type Ingredient = { id: number; name: string; unit: string; unitLabel: string; cost: number; active: boolean };
type Target = { kind: "product"; id: number; name: string; priceCents: number; lines: Line[] } | { kind: "modifier"; id: number; name: string; priceCents: number; lines: Line[] };
type EditLine = { key: number; ingredientId: number; qty: string };

let nextKey = 1;

export function RecipesManager({ products, modifiers, ingredients }: { products: Product[]; modifiers: Modifier[]; ingredients: Ingredient[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [target, setTarget] = useState<Target | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [search, setSearch] = useState("");
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const open = (t: Target) => {
    setTarget(t);
    setEditLines(t.lines.length ? t.lines.map((l) => ({ key: nextKey++, ingredientId: l.ingredientId, qty: fmtQty(l.qty) })) : [{ key: nextKey++, ingredientId: 0, qty: "" }]);
  };
  const update = (key: number, patch: Partial<EditLine>) => setEditLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: number) => setEditLines((ls) => ls.filter((l) => l.key !== key));
  const editCostCents = editLines.reduce((n, l) => n + parseDecimal(l.qty) * (ingById.get(l.ingredientId)?.cost ?? 0) * 100, 0);

  const save = () => {
    if (!target) return;
    const lines = editLines.filter((l) => l.ingredientId).map((l) => ({ ingredientId: l.ingredientId, qty: parseDecimal(l.qty) }));
    const t = target.kind === "product" ? { productId: target.id } : { modifierId: target.id };
    run(() => setRecipeAction(t, lines), { success: `Η συνταγή «${target.name}» αποθηκεύτηκε`, onSuccess: () => setTarget(null) });
  };

  const q = search.trim().toLowerCase();
  const visibleProducts = (q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.categoryName.toLowerCase().includes(q)) : products)
    .slice()
    .sort((a, b) => a.categorySort - b.categorySort || a.name.localeCompare(b.name, "el"));
  const withoutRecipe = products.filter((p) => p.active && !p.lines.length).length;
  const describe = (lines: Line[]) =>
    lines
      .map((l) => {
        const ing = ingById.get(l.ingredientId);
        return ing ? `${fmtQty(l.qty)} ${ing.unitLabel} ${ing.name}` : `#${l.ingredientId}`;
      })
      .join(", ");

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader title="Συνταγές" subtitle="Ποιες πρώτες ύλες και σε τι ποσότητα καταναλώνει κάθε είδος. Το κόστος υπολογίζεται από το τρέχον κόστος των πρώτων υλών." />
      {withoutRecipe > 0 && (
        <InfoBox tone="warn">
          {withoutRecipe} ενεργά είδη δεν έχουν συνταγή: όταν πωλούνται δεν αφαιρείται απόθεμα και δεν υπολογίζεται κόστος/περιθώριο.
        </InfoBox>
      )}

      <Section title="Είδη" actions={<input className="input" placeholder="Αναζήτηση…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Αναζήτηση" />} flush>
        {visibleProducts.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Είδος</th>
                <th>Κατηγορία</th>
                <th className="text-right">Τιμή</th>
                <th className="text-right">Κόστος</th>
                <th className="text-right">Περιθώριο</th>
                <th className="text-right">%</th>
                <th>Υλικά</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((p) => {
                const margin = p.priceCents - p.costCents;
                const pct = p.priceCents ? Math.round((margin / p.priceCents) * 100) : 0;
                const noRecipe = !p.lines.length;
                return (
                  <tr key={p.id} className={`${p.active ? "" : "opacity-60"} ${noRecipe && p.active ? "bg-warn-soft/40" : ""}`}>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-ink-2">{p.categoryName}</td>
                    <td className="text-right">
                      <Money cents={p.priceCents} />
                    </td>
                    <td className="text-right">{noRecipe ? <span className="text-ink-3">—</span> : <Money cents={p.costCents} />}</td>
                    <td className="text-right">{noRecipe ? <span className="text-ink-3">—</span> : <Money cents={margin} className={margin < 0 ? "text-danger" : ""} />}</td>
                    <td className={`text-right num ${noRecipe ? "text-ink-3" : pct < 50 ? "text-warn" : "text-ok"}`}>{noRecipe ? "—" : `${pct}%`}</td>
                    <td className="text-xs text-ink-2 max-w-72">
                      {noRecipe ? (
                        <Badge tone="warn">Χωρίς συνταγή: δεν αφαιρείται απόθεμα</Badge>
                      ) : (
                        <span className="line-clamp-2" title={describe(p.lines)}>
                          {p.lines.length} υλικά · {describe(p.lines)}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <button className="btn-ghost btn-sm" onClick={() => open({ kind: "product", id: p.id, name: p.name, priceCents: p.priceCents, lines: p.lines })}>
                        {noRecipe ? "Ορισμός" : "Επεξεργασία"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4">
            <EmptyState title="Δεν βρέθηκαν είδη" />
          </div>
        )}
      </Section>

      <Section title="Επιλογές με συνταγή" flush>
        {modifiers.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Επιλογή</th>
                <th>Ομάδα</th>
                <th className="text-right">Διαφορά τιμής</th>
                <th>Υλικά</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {modifiers.map((m) => (
                <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                  <td className="font-medium">{m.name}</td>
                  <td className="text-ink-2">{m.groupName}</td>
                  <td className="text-right">{m.priceDeltaCents ? <Money cents={m.priceDeltaCents} /> : <span className="text-ink-3">—</span>}</td>
                  <td className="text-xs text-ink-2">{m.lines.length ? describe(m.lines) : <span className="text-ink-3">Χωρίς συνταγή</span>}</td>
                  <td className="text-right">
                    <button className="btn-ghost btn-sm" onClick={() => open({ kind: "modifier", id: m.id, name: m.name, priceCents: m.priceDeltaCents, lines: m.lines })}>
                      {m.lines.length ? "Επεξεργασία" : "Ορισμός"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν επιλογές.</div>
        )}
      </Section>

      <Modal open={target !== null} onClose={() => setTarget(null)} title={target ? `Συνταγή · ${target.name}` : ""} wide>
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="table-grid">
              <thead>
                <tr>
                  <th className="w-1/2">Πρώτη ύλη</th>
                  <th>Ποσότητα</th>
                  <th className="text-right">Κόστος</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {editLines.map((l) => {
                  const ing = ingById.get(l.ingredientId);
                  return (
                    <tr key={l.key}>
                      <td>
                        <select className="input" value={l.ingredientId || ""} onChange={(e) => update(l.key, { ingredientId: Number(e.target.value) })} aria-label="Πρώτη ύλη">
                          <option value="">— Επίλεξε —</option>
                          {ingredients
                            .filter((i) => i.active || i.id === l.ingredientId)
                            .map((i) => (
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
                      <td className="text-right">
                        <Money cents={Math.round(parseDecimal(l.qty) * (ing?.cost ?? 0) * 100)} />
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => remove(l.key)} aria-label="Αφαίρεση γραμμής">
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!editLines.length && (
                  <tr>
                    <td colSpan={4} className="text-ink-3 text-sm">
                      Χωρίς υλικά. Η αποθήκευση θα αφαιρέσει τη συνταγή.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="text-right font-semibold">
                    Κόστος συνταγής
                  </td>
                  <td className="text-right font-semibold">
                    <Money cents={Math.round(editCostCents)} />
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {target && target.kind === "product" && target.priceCents > 0 && (
            <p className="text-sm text-ink-2">
              Τιμή πώλησης <Money cents={target.priceCents} /> · περιθώριο <Money cents={target.priceCents - Math.round(editCostCents)} /> (
              {Math.round(((target.priceCents - editCostCents) / target.priceCents) * 100)}%)
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditLines((ls) => [...ls, { key: nextKey++, ingredientId: 0, qty: "" }])}>
              + Υλικό
            </button>
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setTarget(null)} disabled={pending}>
                Άκυρο
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={save} disabled={pending}>
                {pending ? "Αποθήκευση…" : "Αποθήκευση"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
