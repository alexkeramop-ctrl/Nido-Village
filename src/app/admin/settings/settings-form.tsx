"use client";
import { Field } from "@/components/ui";
import { Section, formValues, useActionRunner } from "@/components/admin/common";
import { saveSettingsAction } from "./actions";

type Settings = { venueName: string; vatNumber: string; taxOffice: string; address: string; phone: string; courses: number };

export function SettingsForm({ settings }: { settings: Settings }) {
  const { run, pending, toastElement } = useActionRunner();
  return (
    <Section title="Στοιχεία καταστήματος">
      {toastElement}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(new FormData(e.currentTarget));
          run(
            () =>
              saveSettingsAction({
                venueName: v.str("venueName"),
                vatNumber: v.str("vatNumber"),
                taxOffice: v.str("taxOffice"),
                address: v.str("address"),
                phone: v.str("phone"),
                courses: v.int("courses", 3),
              }),
            { success: "Οι ρυθμίσεις αποθηκεύτηκαν" },
          );
        }}
      >
        <Field label="Επωνυμία" hint="Εμφανίζεται στους λογαριασμούς και στις αποδείξεις.">
          <input name="venueName" className="input" required defaultValue={settings.venueName} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ΑΦΜ">
            <input name="vatNumber" className="input num" defaultValue={settings.vatNumber} />
          </Field>
          <Field label="ΔΟΥ">
            <input name="taxOffice" className="input" defaultValue={settings.taxOffice} />
          </Field>
        </div>
        <Field label="Διεύθυνση">
          <input name="address" className="input" defaultValue={settings.address} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Τηλέφωνο">
            <input name="phone" className="input num" type="tel" defaultValue={settings.phone} />
          </Field>
          <Field label="Πιάτα (courses) στο PDA" hint="Πόσα «πιάτα» εμφανίζει το PDA (1–5).">
            <select name="courses" className="input" defaultValue={settings.courses}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary btn-sm" disabled={pending}>
            {pending ? "Αποθήκευση…" : "Αποθήκευση"}
          </button>
        </div>
      </form>
    </Section>
  );
}
