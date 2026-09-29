"use client";
import { useState } from "react";
import { Badge, EmptyState, Field } from "@/components/ui";
import { FormModal, InfoBox, PageHeader, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { fmtDateOnly } from "@/components/admin/format";
import { saveEmployeeAction } from "./actions";

type Employee = { id: number; name: string; role: string; active: boolean; createdAt: string };
type Role = { value: string; label: string };
type EmpModal = { mode: "new" } | { mode: "edit"; emp: Employee } | null;

export function StaffManager({ employees, roles, currentUserId }: { employees: Employee[]; roles: Role[]; currentUserId: number }) {
  const { run, pending, toastElement } = useActionRunner();
  const [modal, setModal] = useState<EmpModal>(null);
  const roleLabel = (r: string) => roles.find((x) => x.value === r)?.label ?? r;

  const submit = (fd: FormData) => {
    const v = formValues(fd);
    const id = modal?.mode === "edit" ? modal.emp.id : undefined;
    const isSelf = id === currentUserId;
    run(() => saveEmployeeAction({ id, name: v.str("name"), role: v.str("role"), pin: v.str("pin"), active: isSelf ? true : v.bool("active") }), {
      success: id ? "Ο υπάλληλος ενημερώθηκε" : "Ο υπάλληλος δημιουργήθηκε",
      onSuccess: () => setModal(null),
    });
  };

  const editing = modal?.mode === "edit" ? modal.emp : null;
  const isSelf = editing?.id === currentUserId;

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Προσωπικό"
        subtitle="Υπάλληλοι, ρόλοι και PIN σύνδεσης."
        actions={
          <button className="btn-primary btn-sm" onClick={() => setModal({ mode: "new" })}>
            + Νέος υπάλληλος
          </button>
        }
      />
      <InfoBox>
        Η σύνδεση γίνεται μόνο με PIN, οπότε κάθε PIN πρέπει να είναι μοναδικό: αν δύο υπάλληλοι έχουν το ίδιο PIN, θα συνδέεται πάντα ο πρώτος. Κράτα τα PIN
        των διαχειριστών ξεχωριστά και άλλαξέ τα όταν κάποιος αποχωρεί.
      </InfoBox>

      <Section flush>
        {employees.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>Ρόλος</th>
                <th>Κατάσταση</th>
                <th>Από</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className={e.active ? "" : "opacity-60"}>
                  <td className="font-medium">
                    {e.name}
                    {e.id === currentUserId && <span className="text-xs text-ink-3"> (εσύ)</span>}
                  </td>
                  <td>
                    <Badge tone={e.role === "admin" ? "brand" : "neutral"}>{roleLabel(e.role)}</Badge>
                  </td>
                  <td>{e.active ? <Badge tone="ok">Ενεργός</Badge> : <Badge>Ανενεργός</Badge>}</td>
                  <td className="num text-ink-3">{fmtDateOnly(e.createdAt)}</td>
                  <td className="text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setModal({ mode: "edit", emp: e })}>
                      Επεξεργασία
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4">
            <EmptyState title="Δεν υπάρχουν υπάλληλοι" />
          </div>
        )}
      </Section>

      <FormModal open={modal !== null} onClose={() => setModal(null)} title={editing ? "Επεξεργασία υπαλλήλου" : "Νέος υπάλληλος"} onSubmit={submit} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editing?.name ?? ""} autoFocus />
        </Field>
        <Field label="Ρόλος">
          <select name="role" className="input" defaultValue={editing?.role ?? "waiter"}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={editing ? "Νέο PIN" : "PIN"} hint={editing ? "4–8 ψηφία. Άφησέ το κενό για να μείνει το τρέχον." : "4–8 ψηφία, μοναδικό ανά υπάλληλο."}>
          <input name="pin" className="input num" inputMode="numeric" pattern="[0-9]{4,8}" autoComplete="off" required={!editing} placeholder={editing ? "••••" : ""} />
        </Field>
        <Toggle name="active" defaultChecked={editing?.active ?? true} label="Ενεργός (μπορεί να συνδεθεί)" disabled={isSelf} />
        {isSelf && <p className="text-xs text-ink-3">Δεν μπορείς να απενεργοποιήσεις τον εαυτό σου.</p>}
      </FormModal>
    </div>
  );
}
