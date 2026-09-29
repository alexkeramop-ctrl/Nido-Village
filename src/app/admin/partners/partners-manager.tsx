"use client";
import { useState } from "react";
import { Badge, EmptyState, Field } from "@/components/ui";
import { FormModal, InfoBox, PageHeader, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { fmtDateOnly, fmtDateTime } from "@/components/admin/format";
import { savePartnerAction } from "./actions";

type PartnerUser = { id: number; name: string; email: string; active: boolean; lastLoginAt: string | null; createdAt: string };
type PModal = { mode: "new" } | { mode: "edit"; user: PartnerUser } | null;

export function PartnersManager({ users, partnersUrl }: { users: PartnerUser[]; partnersUrl: string }) {
  const { run, pending, toastElement } = useActionRunner();
  const [modal, setModal] = useState<PModal>(null);

  const submit = (fd: FormData) => {
    const v = formValues(fd);
    const id = modal?.mode === "edit" ? modal.user.id : undefined;
    run(() => savePartnerAction({ id, name: v.str("name"), email: v.str("email"), password: String(fd.get("password") ?? ""), active: v.bool("active") }), {
      success: id ? "Ο συνεταίρος ενημερώθηκε" : "Ο συνεταίρος δημιουργήθηκε",
      onSuccess: () => setModal(null),
    });
  };
  const editing = modal?.mode === "edit" ? modal.user : null;

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Συνεταίροι"
        subtitle="Χρήστες με πρόσβαση μόνο ανάγνωσης στο online dashboard στατιστικών."
        actions={
          <button className="btn-primary btn-sm" onClick={() => setModal({ mode: "new" })}>
            + Νέος συνεταίρος
          </button>
        }
      />
      <InfoBox>
        Οι συνεταίροι συνδέονται στο <a href={partnersUrl} className="font-semibold underline num" target="_blank" rel="noreferrer">{partnersUrl}</a> με email και κωδικό και βλέπουν μόνο
        στατιστικά (τζίρο, κορυφαία είδη, απόθεμα). Δεν μπορούν να αλλάξουν τίποτα στο κατάστημα.
      </InfoBox>

      <Section flush>
        {users.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Όνομα</th>
                <th>Email</th>
                <th>Κατάσταση</th>
                <th>Τελευταία σύνδεση</th>
                <th>Δημιουργία</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-ink-2">{u.email}</td>
                  <td>{u.active ? <Badge tone="ok">Ενεργός</Badge> : <Badge>Ανενεργός</Badge>}</td>
                  <td className="num text-ink-2">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-ink-3">ποτέ</span>}</td>
                  <td className="num text-ink-3">{fmtDateOnly(u.createdAt)}</td>
                  <td className="text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setModal({ mode: "edit", user: u })}>
                      Επεξεργασία
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4">
            <EmptyState title="Δεν υπάρχουν συνεταίροι" hint="Δημιούργησε τον πρώτο χρήστη για να δει το online dashboard." />
          </div>
        )}
      </Section>

      <FormModal open={modal !== null} onClose={() => setModal(null)} title={editing ? "Επεξεργασία συνεταίρου" : "Νέος συνεταίρος"} onSubmit={submit} pending={pending}>
        <Field label="Όνομα">
          <input name="name" className="input" required defaultValue={editing?.name ?? ""} autoFocus />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className="input" required defaultValue={editing?.email ?? ""} autoComplete="off" />
        </Field>
        <Field label={editing ? "Νέος κωδικός" : "Κωδικός"} hint={editing ? "Τουλάχιστον 8 χαρακτήρες. Άφησέ το κενό για να μείνει ο τρέχων." : "Τουλάχιστον 8 χαρακτήρες."}>
          <input name="password" type="password" className="input" minLength={8} required={!editing} autoComplete="new-password" />
        </Field>
        <Toggle name="active" defaultChecked={editing?.active ?? true} label="Ενεργός (μπορεί να συνδεθεί)" />
      </FormModal>
    </div>
  );
}
