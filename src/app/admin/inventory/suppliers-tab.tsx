"use client";
import { useState } from "react";
import { Badge, EmptyState, Field } from "@/components/ui";
import { FormModal, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { deleteSupplierAction, saveSupplierAction } from "./actions";
import type { Supplier } from "./types";

type SupModal = { mode: "new" } | { mode: "edit"; sup: Supplier } | null;

export function SuppliersTab({ suppliers }: { suppliers: Supplier[] }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [modal, setModal] = useState<SupModal>(null);

  const submit = (fd: FormData) => {
    const v = formValues(fd);
    const id = modal?.mode === "edit" ? modal.sup.id : undefined;
    run(
      () =>
        saveSupplierAction({
          id,
          name: v.str("name"),
          vatNumber: v.strOrNull("vatNumber"),
          phone: v.strOrNull("phone"),
          email: v.strOrNull("email"),
          notes: v.strOrNull("notes"),
          active: v.bool("active"),
        }),
      { success: id ? "Ο προμηθευτής ενημερώθηκε" : "Ο προμηθευτής δημιουργήθηκε", onSuccess: () => setModal(null) },
    );
  };
  const remove = (s: Supplier) => {
    if (!confirm(`Διαγραφή του προμηθευτή «${s.name}»; Αν έχει παραλαβές, θα απενεργοποιηθεί. Οι πρώτες ύλες του μένουν χωρίς προμηθευτή.`)) return;
    run(() => deleteSupplierAction(s.id), {
      onSuccess: (result) => toast(result === "archived" ? `Ο προμηθευτής «${s.name}» έχει παραλαβές, απενεργοποιήθηκε` : `Ο προμηθευτής «${s.name}» διαγράφηκε`),
    });
  };
  const editing = modal?.mode === "edit" ? modal.sup : null;

  return (
    <div className="space-y-4">
      {toastElement}
      <Section
        title="Προμηθευτές"
        actions={
          <button className="btn-primary btn-sm" onClick={() => setModal({ mode: "new" })}>
            + Νέος προμηθευτής
          </button>
        }
        flush
      >
        {suppliers.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>ΑΦΜ</th>
                <th>Τηλέφωνο</th>
                <th>Email</th>
                <th>Σημειώσεις</th>
                <th>Κατάσταση</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                  <td className="font-medium">{s.name}</td>
                  <td className="num text-ink-2">{s.vatNumber ?? "—"}</td>
                  <td className="num text-ink-2">{s.phone ?? "—"}</td>
                  <td className="text-ink-2">{s.email ?? "—"}</td>
                  <td className="text-ink-2 text-xs max-w-56 truncate" title={s.notes ?? undefined}>
                    {s.notes ?? ""}
                  </td>
                  <td>{s.active ? <Badge tone="ok">Ενεργός</Badge> : <Badge>Ανενεργός</Badge>}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => setModal({ mode: "edit", sup: s })}>
                      Επεξεργασία
                    </button>
                    <button className="btn-ghost btn-sm text-danger" onClick={() => remove(s)} disabled={pending} aria-label={`Διαγραφή ${s.name}`}>
                      Διαγραφή
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4">
            <EmptyState title="Δεν υπάρχουν προμηθευτές" />
          </div>
        )}
      </Section>

      <FormModal open={modal !== null} onClose={() => setModal(null)} title={editing ? "Επεξεργασία προμηθευτή" : "Νέος προμηθευτής"} onSubmit={submit} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editing?.name ?? ""} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ΑΦΜ">
            <input name="vatNumber" className="input num" defaultValue={editing?.vatNumber ?? ""} />
          </Field>
          <Field label="Τηλέφωνο">
            <input name="phone" className="input num" type="tel" defaultValue={editing?.phone ?? ""} />
          </Field>
        </div>
        <Field label="Email">
          <input name="email" className="input" type="email" defaultValue={editing?.email ?? ""} />
        </Field>
        <Field label="Σημειώσεις">
          <textarea name="notes" className="input" rows={2} defaultValue={editing?.notes ?? ""} />
        </Field>
        <Toggle name="active" defaultChecked={editing?.active ?? true} label="Ενεργός" />
      </FormModal>
    </div>
  );
}
