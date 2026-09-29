"use client";
import { useState } from "react";
import { Badge, EmptyState, Field, Money } from "@/components/ui";
import { FormModal, PageHeader, Section, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { centsToInput } from "@/components/admin/format";
import { saveGroupAction, saveModifierAction } from "./actions";

type Modifier = { id: number; groupId: number; name: string; priceDeltaCents: number; sort: number; active: boolean };
type Group = { id: number; name: string; minSelect: number; maxSelect: number; active: boolean; modifiers: Modifier[] };

type GroupModal = { mode: "new" } | { mode: "edit"; group: Group } | null;
type ModModal = { mode: "new"; groupId: number } | { mode: "edit"; mod: Modifier } | null;

export function ModifiersManager({ groups }: { groups: Group[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [groupModal, setGroupModal] = useState<GroupModal>(null);
  const [modModal, setModModal] = useState<ModModal>(null);

  const submitGroup = (fd: FormData) => {
    const v = formValues(fd);
    const id = groupModal?.mode === "edit" ? groupModal.group.id : undefined;
    run(() => saveGroupAction({ id, name: v.str("name"), minSelect: v.int("minSelect"), maxSelect: v.int("maxSelect", 1), active: v.bool("active") }), {
      success: id ? "Η ομάδα ενημερώθηκε" : "Η ομάδα δημιουργήθηκε",
      onSuccess: () => setGroupModal(null),
    });
  };

  const submitModifier = (fd: FormData) => {
    const v = formValues(fd);
    if (!modModal) return;
    const id = modModal.mode === "edit" ? modModal.mod.id : undefined;
    const groupId = modModal.mode === "edit" ? modModal.mod.groupId : modModal.groupId;
    run(() => saveModifierAction({ id, groupId, name: v.str("name"), priceDelta: v.str("priceDelta"), sort: v.int("sort"), active: v.bool("active") }), {
      success: id ? "Η επιλογή ενημερώθηκε" : "Η επιλογή προστέθηκε",
      onSuccess: () => setModModal(null),
    });
  };

  const editingGroup = groupModal?.mode === "edit" ? groupModal.group : null;
  const editingMod = modModal?.mode === "edit" ? modModal.mod : null;
  const modGroupName = modModal ? groups.find((g) => g.id === (modModal.mode === "edit" ? modModal.mod.groupId : modModal.groupId))?.name : "";

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Επιλογές"
        subtitle="Ομάδες επιλογών (π.χ. Ψήσιμο, Extras) και οι επιλογές τους. Συνδέονται με είδη από το Μενού."
        actions={
          <button className="btn-primary btn-sm" onClick={() => setGroupModal({ mode: "new" })}>
            + Νέα ομάδα
          </button>
        }
      />

      {groups.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {groups.map((g) => (
            <Section
              key={g.id}
              title={
                <span className="inline-flex items-center gap-2">
                  {g.name}
                  {!g.active && <Badge>Ανενεργή</Badge>}
                  <span className="text-xs font-normal text-ink-3 num">
                    {g.minSelect}–{g.maxSelect} επιλογές
                  </span>
                </span>
              }
              actions={
                <>
                  <button className="btn-ghost btn-sm" onClick={() => setGroupModal({ mode: "edit", group: g })}>
                    Επεξεργασία
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setModModal({ mode: "new", groupId: g.id })}>
                    + Επιλογή
                  </button>
                </>
              }
              flush
            >
              {g.modifiers.length ? (
                <table className="table-grid">
                  <thead>
                    <tr>
                      <th>Σειρά</th>
                      <th>Όνομα</th>
                      <th className="text-right">Διαφορά τιμής</th>
                      <th>Ενεργή</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.modifiers.map((m) => (
                      <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                        <td className="num text-ink-3">{m.sort}</td>
                        <td className="font-medium">{m.name}</td>
                        <td className="text-right">
                          {m.priceDeltaCents ? (
                            <Money cents={m.priceDeltaCents} className={m.priceDeltaCents > 0 ? "text-ok" : "text-danger"} />
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td>{m.active ? <Badge tone="ok">Ναι</Badge> : <Badge>Όχι</Badge>}</td>
                        <td className="text-right">
                          <button className="btn-ghost btn-sm" onClick={() => setModModal({ mode: "edit", mod: m })}>
                            Επεξεργασία
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-4 text-sm text-ink-3">Η ομάδα δεν έχει επιλογές ακόμη.</div>
              )}
            </Section>
          ))}
        </div>
      ) : (
        <EmptyState title="Δεν υπάρχουν ομάδες επιλογών" hint="Δημιούργησε π.χ. «Ψήσιμο» με επιλογές Σενιάν / Μέτριο / Καλοψημένο." />
      )}

      <FormModal open={groupModal !== null} onClose={() => setGroupModal(null)} title={editingGroup ? "Επεξεργασία ομάδας" : "Νέα ομάδα επιλογών"} onSubmit={submitGroup} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editingGroup?.name ?? ""} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ελάχιστες επιλογές" hint="0 = προαιρετική">
            <input name="minSelect" type="number" min={0} className="input num" defaultValue={editingGroup?.minSelect ?? 0} />
          </Field>
          <Field label="Μέγιστες επιλογές">
            <input name="maxSelect" type="number" min={1} className="input num" defaultValue={editingGroup?.maxSelect ?? 1} />
          </Field>
        </div>
        <Toggle name="active" defaultChecked={editingGroup?.active ?? true} label="Ενεργή" />
      </FormModal>

      <FormModal open={modModal !== null} onClose={() => setModModal(null)} title={editingMod ? `Επεξεργασία επιλογής · ${modGroupName}` : `Νέα επιλογή · ${modGroupName}`} onSubmit={submitModifier} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editingMod?.name ?? ""} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Διαφορά τιμής (€)" hint="π.χ. 1,50 ή -0,50. Κενό = 0">
            <input name="priceDelta" className="input num" inputMode="decimal" defaultValue={editingMod && editingMod.priceDeltaCents ? centsToInput(editingMod.priceDeltaCents) : ""} placeholder="0,00" />
          </Field>
          <Field label="Σειρά">
            <input name="sort" type="number" className="input num" defaultValue={editingMod?.sort ?? 0} />
          </Field>
        </div>
        <Toggle name="active" defaultChecked={editingMod?.active ?? true} label="Ενεργή" />
      </FormModal>
    </div>
  );
}
