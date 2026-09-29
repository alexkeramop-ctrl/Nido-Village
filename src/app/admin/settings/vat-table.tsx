"use client";
import { useState } from "react";
import { Badge, Field } from "@/components/ui";
import { FormModal, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { saveVatRateAction } from "./actions";

type Rate = { id: number; name: string; ratePct: number; mydataCategory: number | null; active: boolean };
type RateModal = { mode: "new" } | { mode: "edit"; rate: Rate } | null;

const MYDATA: { value: number; label: string }[] = [
  { value: 1, label: "1 – Κανονικός 24%" },
  { value: 2, label: "2 – Μειωμένος 13%" },
  { value: 3, label: "3 – Υπερμειωμένος 6%" },
  { value: 4, label: "4 – Κανονικός νησιών 17%" },
  { value: 5, label: "5 – Μειωμένος νησιών 9%" },
  { value: 6, label: "6 – Υπερμειωμένος νησιών 4%" },
  { value: 7, label: "7 – Άνευ ΦΠΑ 0%" },
  { value: 8, label: "8 – Εγγραφές χωρίς ΦΠΑ" },
];

export function VatTable({ rates }: { rates: Rate[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [modal, setModal] = useState<RateModal>(null);
  const submit = (fd: FormData) => {
    const v = formValues(fd);
    const id = modal?.mode === "edit" ? modal.rate.id : undefined;
    run(() => saveVatRateAction({ id, name: v.str("name"), ratePct: v.str("ratePct"), mydataCategory: v.intOrNull("mydataCategory"), active: v.bool("active") }), {
      success: id ? "Ο συντελεστής ενημερώθηκε" : "Ο συντελεστής δημιουργήθηκε",
      onSuccess: () => setModal(null),
    });
  };
  const editing = modal?.mode === "edit" ? modal.rate : null;
  return (
    <Section
      title="Συντελεστές ΦΠΑ"
      actions={
        <button className="btn-secondary btn-sm" onClick={() => setModal({ mode: "new" })}>
          + Συντελεστής
        </button>
      }
      flush
    >
      {toastElement}
      <TableWrap>
        <thead>
          <tr>
            <th>Όνομα</th>
            <th className="text-right">%</th>
            <th>Κατηγορία myDATA</th>
            <th>Κατάσταση</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.id} className={r.active ? "" : "opacity-60"}>
              <td className="font-medium">{r.name}</td>
              <td className="text-right num">{r.ratePct}%</td>
              <td className="text-ink-2 text-sm">{r.mydataCategory ? MYDATA.find((m) => m.value === r.mydataCategory)?.label ?? r.mydataCategory : "—"}</td>
              <td>{r.active ? <Badge tone="ok">Ενεργός</Badge> : <Badge>Ανενεργός</Badge>}</td>
              <td className="text-right">
                <button className="btn-ghost btn-sm" onClick={() => setModal({ mode: "edit", rate: r })}>
                  Επεξεργασία
                </button>
              </td>
            </tr>
          ))}
          {!rates.length && (
            <tr>
              <td colSpan={5} className="text-ink-3">
                Δεν υπάρχουν συντελεστές.
              </td>
            </tr>
          )}
        </tbody>
      </TableWrap>
      <p className="px-4 py-3 text-xs text-ink-3 border-t border-line">Η κατηγορία myDATA επιβεβαιώνεται από τον λογιστή. Οι τιμές του μενού περιλαμβάνουν ΦΠΑ.</p>

      <FormModal open={modal !== null} onClose={() => setModal(null)} title={editing ? "Επεξεργασία συντελεστή" : "Νέος συντελεστής ΦΠΑ"} onSubmit={submit} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editing?.name ?? ""} autoFocus placeholder="π.χ. Μειωμένος 13%" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Συντελεστής (%)">
            <input name="ratePct" className="input num" inputMode="decimal" required defaultValue={editing ? String(editing.ratePct).replace(".", ",") : ""} placeholder="13" />
          </Field>
          <Field label="Κατηγορία myDATA">
            <select name="mydataCategory" className="input" defaultValue={editing?.mydataCategory ?? ""}>
              <option value="">—</option>
              {MYDATA.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Toggle name="active" defaultChecked={editing?.active ?? true} label="Ενεργός" />
      </FormModal>
    </Section>
  );
}
