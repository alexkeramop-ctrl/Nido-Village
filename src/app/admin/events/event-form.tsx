"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import { FormModal, InfoBox, Toggle, formValues, type useActionRunner } from "@/components/admin/common";
import { centsToInput } from "@/components/admin/format";
import { parseEuroToCents } from "@/server/money";
import type { EventStatus, EventType } from "@/db/schema";
import { EVENT_STATUSES, EVENT_TYPES } from "@/components/admin/events/meta";
import type { AreaOption, ConflictRow, EventFormInput, EventRow } from "@/components/admin/events/types";
import { checkConflictsAction, saveEventAction } from "./actions";

type Runner = ReturnType<typeof useActionRunner>;

function conflictKey(i: Pick<EventFormInput, "date" | "startTime" | "endTime" | "areaId">) {
  return `${i.date}|${i.startTime}|${i.endTime}|${i.areaId ?? ""}`;
}

/**
 * Φόρμα εκδήλωσης σε modal. Η αποθήκευση γίνεται σε δύο βήματα:
 * πρώτα έλεγχος για συμπτώσεις (ίδια ημέρα/ώρα/χώρος) και, αν υπάρχουν, δεύτερο κλικ «Αποθήκευση παρόλα αυτά».
 */
export function EventForm({
  open,
  onClose,
  initial,
  defaultDate,
  areas,
  typeLabels,
  statusLabels,
  runner,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial: EventRow | null;
  defaultDate: string;
  areas: AreaOption[];
  typeLabels: Record<EventType, string>;
  statusLabels: Record<EventStatus, string>;
  runner: Pick<Runner, "run" | "pending" | "toast">;
  onSaved: () => void;
}) {
  const { run, pending, toast } = runner;
  const [conflicts, setConflicts] = useState<{ key: string; rows: ConflictRow[] } | null>(null);

  function buildInput(fd: FormData): EventFormInput | null {
    const v = formValues(fd);
    let priceCents = 0;
    let depositCents = 0;
    try {
      priceCents = parseEuroToCents(v.str("price") || "0");
      depositCents = parseEuroToCents(v.str("deposit") || "0");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Μη έγκυρο ποσό", "danger");
      return null;
    }
    const startTime = v.str("startTime");
    const endTime = v.str("endTime");
    if (endTime <= startTime) {
      toast("Η ώρα λήξης πρέπει να είναι μετά την ώρα έναρξης", "danger");
      return null;
    }
    return {
      id: initial?.id,
      title: v.str("title"),
      type: v.str("type") as EventType,
      status: v.str("status") as EventStatus,
      date: v.str("date"),
      startTime,
      endTime,
      guests: v.int("guests"),
      areaId: v.intOrNull("areaId"),
      customerName: v.str("customerName"),
      customerPhone: v.strOrNull("customerPhone"),
      customerEmail: v.strOrNull("customerEmail"),
      priceCents,
      depositCents,
      depositPaid: v.bool("depositPaid"),
      menuNotes: v.strOrNull("menuNotes"),
      notes: v.strOrNull("notes"),
    };
  }

  function save(input: EventFormInput) {
    run(() => saveEventAction(input), {
      success: input.id ? "Η εκδήλωση ενημερώθηκε" : "Η εκδήλωση δημιουργήθηκε",
      onSuccess: () => {
        setConflicts(null);
        onSaved();
      },
    });
  }

  function submit(fd: FormData) {
    const input = buildInput(fd);
    if (!input) return;
    const key = conflictKey(input);
    // Δεύτερο κλικ μετά την προειδοποίηση (χωρίς αλλαγή ημέρας/ώρας/χώρου): αποθήκευση παρόλα αυτά.
    if (conflicts && conflicts.key === key) {
      save(input);
      return;
    }
    run(() => checkConflictsAction({ id: input.id, date: input.date, startTime: input.startTime, endTime: input.endTime, areaId: input.areaId }), {
      onSuccess: (rows) => {
        if (rows.length) setConflicts({ key, rows });
        else save(input);
      },
    });
  }

  const clearConflicts = () => setConflicts(null);
  const isEdit = initial !== null;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={isEdit ? "Επεξεργασία εκδήλωσης" : "Νέα εκδήλωση"}
      onSubmit={submit}
      pending={pending}
      submitLabel={conflicts ? "Αποθήκευση παρόλα αυτά" : "Αποθήκευση"}
      wide
    >
      <Field label="Τίτλος">
        <input name="title" className="input" required defaultValue={initial?.title ?? ""} placeholder="π.χ. Βάφτιση Μαρίας" autoFocus />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Τύπος">
          <select name="type" className="input" defaultValue={initial?.type ?? "party"}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabels[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Κατάσταση">
          <select name="status" className="input" defaultValue={initial?.status ?? "inquiry"}>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Field label="Ημερομηνία">
            <input name="date" type="date" className="input num" required defaultValue={initial?.date ?? defaultDate} onChange={clearConflicts} />
          </Field>
        </div>
        <Field label="Έναρξη">
          <input name="startTime" type="time" className="input num" required defaultValue={initial?.startTime ?? "12:00"} onChange={clearConflicts} />
        </Field>
        <Field label="Λήξη">
          <input name="endTime" type="time" className="input num" required defaultValue={initial?.endTime ?? "16:00"} onChange={clearConflicts} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Άτομα">
          <input name="guests" type="number" min={0} inputMode="numeric" className="input num" defaultValue={initial?.guests ?? 0} />
        </Field>
        <Field label="Χώρος">
          <select name="areaId" className="input" defaultValue={initial?.areaId ?? ""} onChange={clearConflicts}>
            <option value="">— όλος ο χώρος —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Πελάτης">
          <input name="customerName" className="input" defaultValue={initial?.customerName ?? ""} placeholder="Ονοματεπώνυμο" />
        </Field>
        <Field label="Τηλέφωνο">
          <input name="customerPhone" type="tel" className="input num" defaultValue={initial?.customerPhone ?? ""} />
        </Field>
      </div>
      <Field label="Email">
        <input name="customerEmail" type="email" className="input" defaultValue={initial?.customerEmail ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:items-end">
        <Field label="Τιμή (€)">
          <input name="price" inputMode="decimal" className="input num" defaultValue={initial ? centsToInput(initial.priceCents) : ""} placeholder="250,00" />
        </Field>
        <Field label="Προκαταβολή (€)">
          <input name="deposit" inputMode="decimal" className="input num" defaultValue={initial ? centsToInput(initial.depositCents) : ""} placeholder="50,00" />
        </Field>
        <div className="col-span-2 sm:col-span-1 sm:pb-3">
          <Toggle name="depositPaid" defaultChecked={initial?.depositPaid ?? false} label="Πληρώθηκε η προκαταβολή" />
        </div>
      </div>
      <Field label="Μενού / πακέτο">
        <textarea name="menuNotes" className="input" rows={2} defaultValue={initial?.menuNotes ?? ""} placeholder="π.χ. παιδικό μενού, τούρτα, ποτά" />
      </Field>
      <Field label="Σημειώσεις">
        <textarea name="notes" className="input" rows={2} defaultValue={initial?.notes ?? ""} />
      </Field>
      {conflicts && (
        <InfoBox tone="warn">
          <div className="font-semibold">Συμπίπτει με:</div>
          <ul className="mt-1 space-y-0.5">
            {conflicts.rows.map((c) => (
              <li key={c.id}>
                «{c.title}» <span className="num">{c.startTime}–{c.endTime}</span> · {c.areaName ?? "όλος ο χώρος"} · {typeLabels[c.type]} · {statusLabels[c.status]}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-xs">Άλλαξε ημέρα, ώρα ή χώρο, ή πάτησε «Αποθήκευση παρόλα αυτά».</div>
        </InfoBox>
      )}
    </FormModal>
  );
}
