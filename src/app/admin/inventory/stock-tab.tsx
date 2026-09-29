"use client";
import { useMemo, useState } from "react";
import { Badge, EmptyState, Field, Money } from "@/components/ui";
import { FormModal, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { euroToInput, fmtPacks, fmtQty } from "@/components/admin/format";
import { adjustStockAction, deleteIngredientAction, recordWasteAction, saveIngredientAction } from "./actions";
import type { Ingredient, Supplier } from "./types";

type EditModal = { mode: "new" } | { mode: "edit"; ing: Ingredient } | null;

export function StockTab({ ingredients, suppliers, units }: { ingredients: Ingredient[]; suppliers: Supplier[]; units: { value: string; label: string }[] }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [editModal, setEditModal] = useState<EditModal>(null);
  const [wasteFor, setWasteFor] = useState<Ingredient | null>(null);
  const [adjustFor, setAdjustFor] = useState<Ingredient | null>(null);
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients.filter((i) => (!q || i.name.toLowerCase().includes(q)) && (!onlyLow || i.low));
  }, [ingredients, search, onlyLow]);
  const totalValue = ingredients.filter((i) => i.active).reduce((n, i) => n + i.stockValueCents, 0);
  const lowCount = ingredients.filter((i) => i.active && i.low).length;

  const submitEdit = (fd: FormData) => {
    const v = formValues(fd);
    const id = editModal?.mode === "edit" ? editModal.ing.id : undefined;
    run(
      () =>
        saveIngredientAction({
          id,
          name: v.str("name"),
          unit: v.str("unit"),
          minQty: v.num("minQty"),
          costPerUnit: v.num("costPerUnit"),
          supplierId: v.intOrNull("supplierId"),
          active: v.bool("active"),
          packSize: v.num("packSize") || null,
          packName: v.strOrNull("packName"),
          portionQty: v.num("portionQty") || null,
          portionName: v.strOrNull("portionName"),
        }),
      { success: id ? "Η πρώτη ύλη ενημερώθηκε" : "Η πρώτη ύλη δημιουργήθηκε", onSuccess: () => setEditModal(null) },
    );
  };

  const remove = (i: Ingredient) => {
    if (!confirm(`Διαγραφή της πρώτης ύλης «${i.name}»; Αν έχει ιστορικό κινήσεων ή παραλαβών, θα απενεργοποιηθεί και θα αφαιρεθεί από τις συνταγές.`)) return;
    run(() => deleteIngredientAction(i.id), {
      onSuccess: (result) => toast(result === "archived" ? `Η πρώτη ύλη «${i.name}» έχει ιστορικό, απενεργοποιήθηκε` : `Η πρώτη ύλη «${i.name}» διαγράφηκε`),
    });
  };

  const submitWaste = (fd: FormData) => {
    const v = formValues(fd);
    if (!wasteFor) return;
    run(() => recordWasteAction({ ingredientId: wasteFor.id, qty: v.num("qty"), note: v.str("note") }), {
      success: `Καταγράφηκε φύρα: ${wasteFor.name}`,
      onSuccess: () => setWasteFor(null),
    });
  };

  const submitAdjust = (fd: FormData) => {
    const v = formValues(fd);
    if (!adjustFor) return;
    run(() => adjustStockAction({ ingredientId: adjustFor.id, delta: v.num("delta"), note: v.str("note") }), {
      success: `Διορθώθηκε το απόθεμα: ${adjustFor.name}`,
      onSuccess: () => setAdjustFor(null),
    });
  };

  const editing = editModal?.mode === "edit" ? editModal.ing : null;

  return (
    <div className="space-y-4">
      {toastElement}
      <Section
        title={
          <span>
            Πρώτες ύλες <span className="text-xs font-normal text-ink-3 num">· αξία αποθέματος <Money cents={totalValue} /></span>
            {lowCount > 0 && (
              <span className="ml-2">
                <Badge tone="danger">{lowCount} χαμηλά</Badge>
              </span>
            )}
          </span>
        }
        actions={
          <button className="btn-primary btn-sm" onClick={() => setEditModal({ mode: "new" })}>
            + Νέα πρώτη ύλη
          </button>
        }
        flush
      >
        <div className="p-3 border-b border-line flex flex-wrap items-center gap-3">
          <input className="input sm:max-w-xs" placeholder="Αναζήτηση…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Αναζήτηση" />
          <Toggle checked={onlyLow} onChange={setOnlyLow} label="Μόνο χαμηλό απόθεμα" />
        </div>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>Μονάδα</th>
                <th className="text-right">Απόθεμα</th>
                <th className="text-right">Ελάχιστο</th>
                <th className="text-right">Κόστος/μον.</th>
                <th className="text-right">Αξία</th>
                <th>Προμηθευτής</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={i.active ? "" : "opacity-60"}>
                  <td className="font-medium">
                    {i.name}
                    {!i.active && <span className="text-xs text-ink-3"> (ανενεργή)</span>}
                  </td>
                  <td className="text-ink-2">{i.unitLabel}</td>
                  <td className="text-right">
                    <span className={`num ${i.low ? "text-danger font-semibold" : ""}`}>{fmtQty(i.stock)}</span>
                    {i.low && (
                      <span className="ml-2">
                        <Badge tone="danger">Χαμηλό</Badge>
                      </span>
                    )}
                    {(i.stockPacks !== null || i.stockPortions !== null) && (
                      <div className="text-xs text-ink-3 num whitespace-nowrap">
                        {[
                          i.stockPacks !== null ? fmtPacks(i.stockPacks, i.packName ?? "συσκευασία") : null,
                          i.stockPortions !== null ? fmtPacks(i.stockPortions, i.portionName ?? "μερίδα") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="text-right num text-ink-2">{fmtQty(i.min)}</td>
                  <td className="text-right num text-ink-2">{euroToInput(i.cost)} €</td>
                  <td className="text-right">
                    <Money cents={i.stockValueCents} />
                  </td>
                  <td className="text-ink-2">{i.supplierName ?? <span className="text-ink-3">—</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => setWasteFor(i)}>
                      Φύρα
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setAdjustFor(i)}>
                      Διόρθωση
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setEditModal({ mode: "edit", ing: i })}>
                      Επεξεργασία
                    </button>
                    <button className="btn-ghost btn-sm text-danger" onClick={() => remove(i)} disabled={pending} aria-label={`Διαγραφή ${i.name}`}>
                      Διαγραφή
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4">
            <EmptyState title="Δεν βρέθηκαν πρώτες ύλες" hint={ingredients.length ? "Άλλαξε το φίλτρο." : "Πρόσθεσε την πρώτη πρώτη ύλη."} />
          </div>
        )}
      </Section>

      <FormModal open={editModal !== null} onClose={() => setEditModal(null)} title={editing ? "Επεξεργασία πρώτης ύλης" : "Νέα πρώτη ύλη"} onSubmit={submitEdit} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editing?.name ?? ""} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Μονάδα μέτρησης">
            <select name="unit" className="input" defaultValue={editing?.unit ?? "g"}>
              {units.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label} ({u.value})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ελάχιστο απόθεμα" hint="0 = χωρίς ειδοποίηση">
            <input name="minQty" className="input num" inputMode="decimal" defaultValue={editing ? fmtQty(editing.min) : "0"} />
          </Field>
        </div>
        <Field label="Κόστος ανά μονάδα (€)" hint="π.χ. 0,0095 €/γρ. Ενημερώνεται αυτόματα στις παραλαβές (κινούμενος μέσος).">
          <input name="costPerUnit" className="input num" inputMode="decimal" defaultValue={editing ? euroToInput(editing.cost) : "0"} />
        </Field>
        <Field label="Προμηθευτής">
          <select name="supplierId" className="input" defaultValue={editing?.supplierId ?? ""}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="rounded-xl border border-line p-3 space-y-3">
          <legend className="label px-1">Συσκευασία &amp; μερίδα (προαιρετικά)</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Μέγεθος συσκευασίας" hint="σε μονάδες της πρώτης ύλης">
              <input name="packSize" className="input num" inputMode="decimal" defaultValue={editing?.packSize ? fmtQty(editing.packSize) : ""} placeholder="π.χ. 700" />
            </Field>
            <Field label="Όνομα συσκευασίας">
              <input name="packName" className="input" defaultValue={editing?.packName ?? ""} placeholder="μπουκάλι" />
            </Field>
            <Field label="Ποσότητα μερίδας" hint="σε μονάδες της πρώτης ύλης">
              <input name="portionQty" className="input num" inputMode="decimal" defaultValue={editing?.portionQty ? fmtQty(editing.portionQty) : ""} placeholder="π.χ. 60" />
            </Field>
            <Field label="Όνομα μερίδας">
              <input name="portionName" className="input" defaultValue={editing?.portionName ?? ""} placeholder="ποτό" />
            </Field>
          </div>
          <p className="text-xs text-ink-3">π.χ. μπουκάλι 700 ml, ποτό 60 ml → 11 ποτά ανά μπουκάλι. Επιτρέπει απογραφή σε συσκευασίες και αναφορές σε μερίδες.</p>
        </fieldset>
        {editing && <p className="text-xs text-ink-3">Τρέχον απόθεμα: {fmtQty(editing.stock)} {editing.unitLabel}. Για αλλαγή αποθέματος χρησιμοποίησε «Διόρθωση» ή «Απογραφή».</p>}
        <Toggle name="active" defaultChecked={editing?.active ?? true} label="Ενεργή" />
      </FormModal>

      <FormModal open={wasteFor !== null} onClose={() => setWasteFor(null)} title={`Φύρα · ${wasteFor?.name ?? ""}`} onSubmit={submitWaste} pending={pending} submitLabel="Καταγραφή φύρας">
        <p className="text-sm text-ink-2">
          Τρέχον απόθεμα: <span className="num font-semibold">{wasteFor ? fmtQty(wasteFor.stock) : ""}</span> {wasteFor?.unitLabel}
        </p>
        <Field label={`Ποσότητα (${wasteFor?.unitLabel ?? ""})`}>
          <input name="qty" className="input num" inputMode="decimal" required autoFocus placeholder="0" />
        </Field>
        <Field label="Αιτιολογία">
          <input name="note" className="input" placeholder="π.χ. έληξε, έπεσε, κακή ποιότητα" />
        </Field>
      </FormModal>

      <FormModal open={adjustFor !== null} onClose={() => setAdjustFor(null)} title={`Διόρθωση αποθέματος · ${adjustFor?.name ?? ""}`} onSubmit={submitAdjust} pending={pending} submitLabel="Καταχώρηση">
        <p className="text-sm text-ink-2">
          Τρέχον απόθεμα: <span className="num font-semibold">{adjustFor ? fmtQty(adjustFor.stock) : ""}</span> {adjustFor?.unitLabel}
        </p>
        <Field label={`Διαφορά ± (${adjustFor?.unitLabel ?? ""})`} hint="Θετικός αριθμός προσθέτει, αρνητικός αφαιρεί.">
          <input name="delta" className="input num" inputMode="decimal" required autoFocus placeholder="π.χ. -250 ή 1000" />
        </Field>
        <Field label="Αιτιολογία">
          <input name="note" className="input" placeholder="π.χ. λάθος καταχώρηση" />
        </Field>
      </FormModal>
    </div>
  );
}
