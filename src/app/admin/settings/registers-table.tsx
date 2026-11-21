"use client";
import { useState } from "react";
import { Badge, Field } from "@/components/ui";
import { FormModal, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { saveRegisterAction } from "./actions";

type Register = { id: number; name: string; sort: number; active: boolean; openShift: boolean; areaId: number | null; areaName: string | null };
type AreaOption = { id: number; name: string; barName: string | null };
type RegisterModal = { mode: "new" } | { mode: "edit"; register: Register } | null;

/** Τα ταμεία του καταστήματος («Ταμείο 1», «Ταμείο 2»…): προσθήκη, μετονομασία, σειρά, ενεργό/ανενεργό. */
export function RegistersTable({ registers, areas }: { registers: Register[]; areas: AreaOption[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [modal, setModal] = useState<RegisterModal>(null);
  const editing = modal?.mode === "edit" ? modal.register : null;
  const submit = (fd: FormData) => {
    const v = formValues(fd);
    run(
      () =>
        saveRegisterAction({
          id: editing?.id,
          name: v.str("name"),
          sort: v.int("sort", editing?.sort ?? registers.length + 1),
          active: editing ? v.bool("active") : true,
          areaId: v.intOrNull("areaId"),
        }),
      {
      success: editing ? "Το ταμείο ενημερώθηκε" : "Το ταμείο δημιουργήθηκε",
        onSuccess: () => setModal(null),
      },
    );
  };
  return (
    <Section
      title="Ταμεία"
      actions={
        <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: "new" })}>
          + Ταμείο
        </button>
      }
      flush
    >
      {toastElement}
      <TableWrap>
        <thead>
          <tr>
            <th>Όνομα</th>
            <th>Χώρος</th>
            <th className="text-right">Σειρά</th>
            <th>Κατάσταση</th>
            <th data-nosort></th>
          </tr>
        </thead>
        <tbody>
          {registers.map((r) => (
            <tr key={r.id} className={r.active ? "" : "opacity-60"}>
              <td className="font-medium">{r.name}</td>
              <td className="text-ink-2">{r.areaName ?? "—"}</td>
              <td className="text-right num">{r.sort}</td>
              <td>
                <span className="flex flex-wrap gap-1.5">
                  {r.active ? <Badge tone="ok">Ενεργό</Badge> : <Badge>Ανενεργό</Badge>}
                  {r.openShift && <Badge tone="warn">Ανοιχτή βάρδια</Badge>}
                </span>
              </td>
              <td className="text-right">
                <button className="btn-ghost btn-sm" onClick={() => setModal({ mode: "edit", register: r })} aria-label={`Επεξεργασία ${r.name}`}>
                  Επεξεργασία
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p className="px-4 py-3 text-xs text-ink-3 border-t border-line">
        Κάθε ταμείο ανοίγει και κλείνει τη δική του βάρδια. Ο «Χώρος» του ταμείου ορίζει σε ποιο μπαρ τυπώνονται τα ροφήματα που πουλάει και ποια QR
        τραπέζια προτείνονται στο άνοιγμα βάρδιας. Ένα ταμείο με ανοιχτή βάρδια δεν απενεργοποιείται· τα ταμεία δεν διαγράφονται για να μένει το ιστορικό τους.
      </p>

      <FormModal open={modal !== null} onClose={() => setModal(null)} title={editing ? `Επεξεργασία · ${editing.name}` : "Νέο ταμείο"} onSubmit={submit} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required maxLength={30} defaultValue={editing?.name ?? `Ταμείο ${registers.length + 1}`} autoFocus />
        </Field>
        <Field label="Χώρος (μπαρ για τα ροφήματα)">
          <select name="areaId" className="input" defaultValue={editing?.areaId ?? ""}>
            <option value="">— Χωρίς χώρο (κάθε είδος στο δικό του μπαρ) —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.barName ? ` → ${a.barName}` : " (χωρίς δικό του μπαρ)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Σειρά εμφάνισης">
          <input name="sort" className="input num" inputMode="numeric" defaultValue={editing?.sort ?? registers.length + 1} />
        </Field>
        {editing && (
          <div>
            <Toggle name="active" defaultChecked={editing.active} label="Ενεργό" disabled={editing.openShift && editing.active} />
            {editing.openShift && editing.active && <p className="text-xs text-warn mt-1">Έχει ανοιχτή βάρδια: κλείσε την πρώτα για να το απενεργοποιήσεις.</p>}
            {/* Το απενεργοποιημένο checkbox δεν στέλνεται στη φόρμα: κρατάμε την τιμή του. */}
            {editing.openShift && editing.active && <input type="hidden" name="active" value="on" />}
          </div>
        )}
      </FormModal>
    </Section>
  );
}
