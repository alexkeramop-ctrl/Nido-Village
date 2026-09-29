"use client";
import { useMemo, useState } from "react";
import { Badge, EmptyState, Field, Money } from "@/components/ui";
import { FormModal, PageHeader, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { centsToInput } from "@/components/admin/format";
import { saveCategoryAction, saveProductAction, setAvailabilityAction } from "./actions";

type Category = { id: number; name: string; sort: number; color: string; printStationId: number | null; stationName: string | null; active: boolean };
type Product = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  priceCents: number;
  vatRateId: number;
  vatLabel: string;
  printStationId: number | null;
  stationName: string | null;
  sku: string | null;
  available: boolean;
  active: boolean;
  sort: number;
  groupIds: number[];
  groupNames: string[];
};
type Station = { id: number; name: string };
type VatRate = { id: number; name: string; ratePct: number };
type Group = { id: number; name: string; active: boolean };

type CatModal = { mode: "new" } | { mode: "edit"; cat: Category } | null;
type ProdModal = { mode: "new" } | { mode: "edit"; prod: Product } | null;

export function MenuManager({
  categories,
  products,
  stations,
  vatRates,
  groups,
}: {
  categories: Category[];
  products: Product[];
  stations: Station[];
  vatRates: VatRate[];
  groups: Group[];
}) {
  const { run, pending, toastElement } = useActionRunner();
  const [catModal, setCatModal] = useState<CatModal>(null);
  const [prodModal, setProdModal] = useState<ProdModal>(null);
  const [catFilter, setCatFilter] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => (catFilter === null || p.categoryId === catFilter) && (!q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)));
  }, [products, catFilter, search]);

  const submitCategory = (fd: FormData) => {
    const v = formValues(fd);
    const id = catModal?.mode === "edit" ? catModal.cat.id : undefined;
    run(
      () =>
        saveCategoryAction({
          id,
          name: v.str("name"),
          sort: v.int("sort"),
          color: v.str("color") || "#0f766e",
          printStationId: v.intOrNull("printStationId"),
          active: v.bool("active"),
        }),
      { success: id ? "Η κατηγορία ενημερώθηκε" : "Η κατηγορία δημιουργήθηκε", onSuccess: () => setCatModal(null) },
    );
  };

  const submitProduct = (fd: FormData) => {
    const v = formValues(fd);
    const id = prodModal?.mode === "edit" ? prodModal.prod.id : undefined;
    run(
      () =>
        saveProductAction({
          id,
          name: v.str("name"),
          categoryId: v.int("categoryId"),
          price: v.str("price"),
          vatRateId: v.int("vatRateId"),
          printStationId: v.intOrNull("printStationId"),
          sku: v.strOrNull("sku"),
          available: v.bool("available"),
          active: v.bool("active"),
          sort: v.int("sort"),
          modifierGroupIds: v.ints("groupIds"),
        }),
      { success: id ? "Το είδος ενημερώθηκε" : "Το είδος δημιουργήθηκε", onSuccess: () => setProdModal(null) },
    );
  };

  const toggleCategoryActive = (c: Category, active: boolean) =>
    run(() => saveCategoryAction({ id: c.id, name: c.name, sort: c.sort, color: c.color, printStationId: c.printStationId, active }), {
      success: active ? "Η κατηγορία ενεργοποιήθηκε" : "Η κατηγορία απενεργοποιήθηκε",
    });

  const editingCat = catModal?.mode === "edit" ? catModal.cat : null;
  const editingProd = prodModal?.mode === "edit" ? prodModal.prod : null;

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Μενού"
        subtitle={`${categories.length} κατηγορίες · ${products.length} είδη`}
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setCatModal({ mode: "new" })}>
              + Νέα κατηγορία
            </button>
            <button className="btn-primary btn-sm" onClick={() => setProdModal({ mode: "new" })} disabled={!categories.length || !vatRates.length}>
              + Νέο είδος
            </button>
          </>
        }
      />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 items-start">
        <Section title="Κατηγορίες" flush>
          {categories.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th>Σειρά</th>
                  <th>Όνομα</th>
                  <th>Σταθμός</th>
                  <th>Ενεργή</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                    <td className="num text-ink-3">{c.sort}</td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-4 w-4 rounded-full border border-line" style={{ backgroundColor: c.color }} aria-hidden />
                        <span className="font-medium">{c.name}</span>
                      </span>
                    </td>
                    <td className="text-ink-2">{c.stationName ?? <span className="text-ink-3">—</span>}</td>
                    <td>
                      <Toggle checked={c.active} onChange={(v) => toggleCategoryActive(c, v)} disabled={pending} title="Ενεργή" />
                    </td>
                    <td className="text-right">
                      <button className="btn-ghost btn-sm" onClick={() => setCatModal({ mode: "edit", cat: c })}>
                        Επεξεργασία
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <div className="p-4">
              <EmptyState title="Δεν υπάρχουν κατηγορίες" hint="Δημιούργησε την πρώτη κατηγορία για να προσθέσεις είδη." />
            </div>
          )}
        </Section>

        <Section title="Είδη" flush>
          <div className="p-3 border-b border-line space-y-2">
            <input className="input" placeholder="Αναζήτηση είδους ή SKU…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Αναζήτηση" />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button className={`chip whitespace-nowrap ${catFilter === null ? "bg-brand text-white" : "bg-surface-3 text-ink-2"}`} onClick={() => setCatFilter(null)}>
                Όλα ({products.length})
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`chip whitespace-nowrap ${catFilter === c.id ? "bg-brand text-white" : "bg-surface-3 text-ink-2"}`}
                  onClick={() => setCatFilter(catFilter === c.id ? null : c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          {filtered.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th>Όνομα</th>
                  <th>Κατηγορία</th>
                  <th className="text-right">Τιμή</th>
                  <th>ΦΠΑ</th>
                  <th>Σταθμός</th>
                  <th>Διαθέσιμο</th>
                  <th>Ενεργό</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                    <td>
                      <div className="font-medium">{p.name}</div>
                      {(p.sku || p.groupNames.length > 0) && (
                        <div className="text-xs text-ink-3">
                          {p.sku && <span className="num">{p.sku}</span>}
                          {p.sku && p.groupNames.length > 0 && " · "}
                          {p.groupNames.join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="text-ink-2">{p.categoryName}</td>
                    <td className="text-right">
                      <Money cents={p.priceCents} />
                    </td>
                    <td className="num text-ink-2">{p.vatLabel}</td>
                    <td className="text-ink-2">{p.stationName ?? <span className="text-ink-3">κατηγορίας</span>}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Toggle
                          checked={p.available}
                          disabled={pending}
                          onChange={(v) => run(() => setAvailabilityAction(p.id, v), { success: v ? `${p.name}: Διαθέσιμο` : `${p.name}: Εξαντλήθηκε` })}
                          title="Εξαντλήθηκε / Διαθέσιμο"
                        />
                        {!p.available && <Badge tone="warn">Εξαντλήθηκε</Badge>}
                      </div>
                    </td>
                    <td>{p.active ? <Badge tone="ok">Ενεργό</Badge> : <Badge>Ανενεργό</Badge>}</td>
                    <td className="text-right">
                      <button className="btn-ghost btn-sm" onClick={() => setProdModal({ mode: "edit", prod: p })}>
                        Επεξεργασία
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <div className="p-4">
              <EmptyState title="Δεν βρέθηκαν είδη" hint={products.length ? "Δοκίμασε άλλο φίλτρο ή αναζήτηση." : "Πρόσθεσε το πρώτο είδος."} />
            </div>
          )}
        </Section>
      </div>

      <FormModal open={catModal !== null} onClose={() => setCatModal(null)} title={editingCat ? "Επεξεργασία κατηγορίας" : "Νέα κατηγορία"} onSubmit={submitCategory} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editingCat?.name ?? ""} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Σειρά">
            <input name="sort" type="number" className="input num" defaultValue={editingCat?.sort ?? categories.length + 1} />
          </Field>
          <Field label="Χρώμα">
            <input name="color" type="color" className="input h-11 p-1" defaultValue={editingCat?.color ?? "#0f766e"} />
          </Field>
        </div>
        <Field label="Σταθμός εκτύπωσης" hint="Πού τυπώνονται οι παραγγελίες αυτής της κατηγορίας.">
          <select name="printStationId" className="input" defaultValue={editingCat?.printStationId ?? ""}>
            <option value="">— Χωρίς εκτύπωση —</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Toggle name="active" defaultChecked={editingCat?.active ?? true} label="Ενεργή (εμφανίζεται στο PDA)" />
      </FormModal>

      <FormModal open={prodModal !== null} onClose={() => setProdModal(null)} title={editingProd ? "Επεξεργασία είδους" : "Νέο είδος"} onSubmit={submitProduct} pending={pending} wide>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="Όνομα">
              <input name="name" className="input" required defaultValue={editingProd?.name ?? ""} autoFocus />
            </Field>
          </div>
          <Field label="Κατηγορία">
            <select name="categoryId" className="input" required defaultValue={editingProd?.categoryId ?? catFilter ?? categories[0]?.id ?? ""}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Τιμή (€)" hint="Τελική τιμή με ΦΠΑ, π.χ. 12,50">
            <input name="price" className="input num" inputMode="decimal" required defaultValue={editingProd ? centsToInput(editingProd.priceCents) : ""} placeholder="0,00" />
          </Field>
          <Field label="ΦΠΑ">
            <select name="vatRateId" className="input" required defaultValue={editingProd?.vatRateId ?? vatRates[0]?.id ?? ""}>
              {vatRates.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.ratePct}%)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Σταθμός εκτύπωσης">
            <select name="printStationId" className="input" defaultValue={editingProd?.printStationId ?? ""}>
              <option value="">Της κατηγορίας</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="SKU / κωδικός">
            <input name="sku" className="input" defaultValue={editingProd?.sku ?? ""} />
          </Field>
          <Field label="Σειρά">
            <input name="sort" type="number" className="input num" defaultValue={editingProd?.sort ?? 0} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Toggle name="available" defaultChecked={editingProd?.available ?? true} label="Διαθέσιμο" />
          <Toggle name="active" defaultChecked={editingProd?.active ?? true} label="Ενεργό" />
        </div>
        <fieldset>
          <legend className="label">Ομάδες επιλογών</legend>
          {groups.length ? (
            <div className="grid sm:grid-cols-2 gap-1.5">
              {groups.map((g) => (
                <label key={g.id} className={`flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm ${g.active ? "" : "opacity-60"}`}>
                  <input type="checkbox" name="groupIds" value={g.id} defaultChecked={editingProd?.groupIds.includes(g.id) ?? false} className="h-4 w-4 accent-brand" />
                  <span>{g.name}</span>
                  {!g.active && <span className="text-xs text-ink-3">(ανενεργή)</span>}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Δεν υπάρχουν ομάδες επιλογών. Δημιούργησε από τη σελίδα «Επιλογές».</p>
          )}
        </fieldset>
      </FormModal>
    </div>
  );
}
