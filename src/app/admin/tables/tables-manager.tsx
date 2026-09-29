"use client";
import { useState } from "react";
import { Badge, EmptyState, Field } from "@/components/ui";
import { FormModal, PageHeader, Section, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { createTablesBatchAction, saveAreaAction, saveTableAction } from "./actions";

type Table = { id: number; areaId: number; name: string; seats: number; sort: number; active: boolean };
type Area = { id: number; name: string; sort: number; active: boolean; barStationId: number | null; barName: string | null; tables: Table[] };
type Bar = { id: number; name: string };

type AreaModal = { mode: "new" } | { mode: "edit"; area: Area } | null;
type TableModal = { mode: "new"; areaId: number } | { mode: "edit"; table: Table } | null;

export function TablesManager({ areas, bars }: { areas: Area[]; bars: Bar[] }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [areaModal, setAreaModal] = useState<AreaModal>(null);
  const [tableModal, setTableModal] = useState<TableModal>(null);
  const [batchAreaId, setBatchAreaId] = useState<number | null>(null);

  const submitArea = (fd: FormData) => {
    const v = formValues(fd);
    const id = areaModal?.mode === "edit" ? areaModal.area.id : undefined;
    run(() => saveAreaAction({ id, name: v.str("name"), sort: v.int("sort"), active: v.bool("active"), barStationId: v.intOrNull("barStationId") }), {
      success: id ? "Ο χώρος ενημερώθηκε" : "Ο χώρος δημιουργήθηκε",
      onSuccess: () => setAreaModal(null),
    });
  };

  const submitTable = (fd: FormData) => {
    const v = formValues(fd);
    if (!tableModal) return;
    const id = tableModal.mode === "edit" ? tableModal.table.id : undefined;
    run(() => saveTableAction({ id, areaId: v.int("areaId"), name: v.str("name"), seats: v.int("seats", 4), sort: v.int("sort"), active: v.bool("active") }), {
      success: id ? "Το τραπέζι ενημερώθηκε" : "Το τραπέζι δημιουργήθηκε",
      onSuccess: () => setTableModal(null),
    });
  };

  const submitBatch = (fd: FormData) => {
    const v = formValues(fd);
    run(() => createTablesBatchAction({ areaId: v.int("areaId"), prefix: v.str("prefix"), from: v.int("from", 1), to: v.int("to", 1), seats: v.int("seats", 4) }), {
      onSuccess: (n) => {
        setBatchAreaId(null);
        toast(`Δημιουργήθηκαν ${n} τραπέζια`);
      },
    });
  };

  const editingArea = areaModal?.mode === "edit" ? areaModal.area : null;
  const editingTable = tableModal?.mode === "edit" ? tableModal.table : null;
  const batchArea = areas.find((a) => a.id === batchAreaId);

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Τραπέζια"
        subtitle={`${areas.length} χώροι · ${areas.reduce((n, a) => n + a.tables.length, 0)} τραπέζια`}
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setBatchAreaId(areas[0]?.id ?? null)} disabled={!areas.length}>
              Μαζική δημιουργία
            </button>
            <button className="btn-primary btn-sm" onClick={() => setAreaModal({ mode: "new" })}>
              + Νέος χώρος
            </button>
          </>
        }
      />

      {areas.length ? (
        <div className="space-y-4">
          {areas.map((a) => (
            <Section
              key={a.id}
              title={
                <span className="inline-flex items-center gap-2">
                  {a.name}
                  {!a.active && <Badge>Ανενεργός</Badge>}
                  <span className="text-xs font-normal text-ink-3 num">
                    σειρά {a.sort} · {a.tables.length} τραπέζια · μπαρ: {a.barName ?? "—"}
                  </span>
                </span>
              }
              actions={
                <>
                  <button className="btn-ghost btn-sm" onClick={() => setAreaModal({ mode: "edit", area: a })}>
                    Επεξεργασία χώρου
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setTableModal({ mode: "new", areaId: a.id })}>
                    + Τραπέζι
                  </button>
                </>
              }
            >
              {a.tables.length ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
                  {a.tables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTableModal({ mode: "edit", table: t })}
                      className={`text-left rounded-xl border border-line p-3 hover:border-brand transition-colors ${t.active ? "bg-surface-2" : "bg-surface-3 opacity-60"}`}
                    >
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-xs text-ink-3 num">
                        {t.seats} θέσεις · σειρά {t.sort}
                      </div>
                      {!t.active && <div className="text-xs text-ink-3 mt-1">Ανενεργό</div>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-ink-3">Ο χώρος δεν έχει τραπέζια.</div>
              )}
            </Section>
          ))}
        </div>
      ) : (
        <EmptyState title="Δεν υπάρχουν χώροι" hint="Δημιούργησε έναν χώρο (π.χ. Σαλόνι, Αυλή) και μετά πρόσθεσε τραπέζια." />
      )}

      <FormModal open={areaModal !== null} onClose={() => setAreaModal(null)} title={editingArea ? "Επεξεργασία χώρου" : "Νέος χώρος"} onSubmit={submitArea} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editingArea?.name ?? ""} autoFocus />
        </Field>
        <Field label="Σειρά">
          <input name="sort" type="number" className="input num" defaultValue={editingArea?.sort ?? areas.length + 1} />
        </Field>
        <Field label="Μπαρ χώρου" hint="Τα ροφήματα των τραπεζιών αυτού του χώρου τυπώνονται σε αυτό το μπαρ.">
          <select name="barStationId" className="input" defaultValue={editingArea?.barStationId ?? ""}>
            <option value="">— κανένα —</option>
            {bars.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Toggle name="active" defaultChecked={editingArea?.active ?? true} label="Ενεργός" />
      </FormModal>

      <FormModal open={tableModal !== null} onClose={() => setTableModal(null)} title={editingTable ? "Επεξεργασία τραπεζιού" : "Νέο τραπέζι"} onSubmit={submitTable} pending={pending}>
        <Field label="Χώρος">
          <select name="areaId" className="input" defaultValue={editingTable?.areaId ?? (tableModal?.mode === "new" ? tableModal.areaId : "")}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editingTable?.name ?? ""} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Θέσεις">
            <input name="seats" type="number" min={1} className="input num" defaultValue={editingTable?.seats ?? 4} />
          </Field>
          <Field label="Σειρά">
            <input name="sort" type="number" className="input num" defaultValue={editingTable?.sort ?? 0} />
          </Field>
        </div>
        <Toggle name="active" defaultChecked={editingTable?.active ?? true} label="Ενεργό" />
      </FormModal>

      <FormModal open={batchAreaId !== null} onClose={() => setBatchAreaId(null)} title="Μαζική δημιουργία τραπεζιών" onSubmit={submitBatch} pending={pending} submitLabel="Δημιουργία">
        <Field label="Χώρος">
          <select name="areaId" className="input" defaultValue={batchArea?.id ?? ""}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Πρόθεμα" hint="π.χ. «Α» δίνει Α1, Α2, …">
          <input name="prefix" className="input" defaultValue="" placeholder="Α" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Από">
            <input name="from" type="number" min={1} className="input num" defaultValue={1} />
          </Field>
          <Field label="Έως">
            <input name="to" type="number" min={1} className="input num" defaultValue={10} />
          </Field>
          <Field label="Θέσεις">
            <input name="seats" type="number" min={1} className="input num" defaultValue={4} />
          </Field>
        </div>
      </FormModal>
    </div>
  );
}
