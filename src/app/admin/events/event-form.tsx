"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import { FormModal, InfoBox, Time24, Toggle, formValues, type useActionRunner } from "@/components/admin/common";
import { centsToInput } from "@/components/admin/format";
import { parseEuroToCents } from "@/server/money";
import type { EventStatus, EventType, PartyDetails } from "@/db/schema";
import { EVENT_STATUSES } from "@/components/admin/events/meta";
import { longDateLabel } from "@/components/admin/events/dates";
import { ADULT_MENUS, PARTY_EXTRAS, PARTY_MINUTES, PARTY_PACKAGES, addMinutes, isMonToThu, quoteParty } from "@/components/admin/events/party";
import { Money } from "@/components/ui";
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
  allowedTypes,
  defaultType,
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
  allowedTypes: EventType[];
  defaultType: EventType;
  runner: Pick<Runner, "run" | "pending" | "toast">;
  onSaved: () => void;
}) {
  const { run, pending, toast } = runner;
  const [conflicts, setConflicts] = useState<{ key: string; rows: ConflictRow[] } | null>(null);
  const [type, setType] = useState<EventType>(initial?.type ?? defaultType);
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [party, setParty] = useState<PartyDetails>(
    initial?.party ?? { kids: 15, adults: 15, package: "bounce", adultMenu: "classic", extras: [], childName: "", childAge: null, theme: "", cake: "" },
  );
  const [price, setPrice] = useState(initial ? centsToInput(initial.priceCents) : "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? (defaultType === "party" ? "11:00" : defaultType === "appointment" ? "18:00" : "12:00"));
  const [endTime, setEndTime] = useState(
    initial?.endTime ?? (defaultType === "party" ? addMinutes("11:00", PARTY_MINUTES) : defaultType === "appointment" ? "19:00" : "16:00"),
  );
  const isParty = type === "party";
  const quote = isParty ? quoteParty(party, date) : null;
  const setP = (patch: Partial<PartyDetails>) => setParty((p) => ({ ...p, ...patch }));
  const typeChoices = initial && !allowedTypes.includes(initial.type) ? [...allowedTypes, initial.type] : allowedTypes;

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
      guests: isParty ? (party.kids ?? 0) + (party.adults ?? 0) : v.int("guests"),
      areaId: v.intOrNull("areaId"),
      customerName: v.str("customerName"),
      customerPhone: v.strOrNull("customerPhone"),
      customerEmail: v.strOrNull("customerEmail"),
      priceCents,
      depositCents,
      depositPaid: v.bool("depositPaid"),
      menuNotes: v.strOrNull("menuNotes"),
      notes: v.strOrNull("notes"),
      party: isParty ? party : null,
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
      title={isEdit ? `Επεξεργασία: ${typeLabels[type]}` : isParty ? "Νέο παιδικό πάρτι" : type === "appointment" ? "Νέο ραντεβού" : "Νέα κράτηση"}
      onSubmit={submit}
      pending={pending}
      submitLabel={conflicts ? "Αποθήκευση παρόλα αυτά" : "Αποθήκευση"}
      wide
    >
      <Field label="Τίτλος">
        <input name="title" className="input" required defaultValue={initial?.title ?? ""} placeholder={isParty ? "π.χ. Πάρτι Γιώργου" : type === "appointment" ? "π.χ. Γνωριμία – γάμος Παπαδόπουλου" : "π.χ. Βάφτιση Μαρίας"} autoFocus />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Τύπος">
          <select
            name="type"
            className="input"
            value={type}
            onChange={(e) => {
              const t = e.target.value as EventType;
              setType(t);
              if (!isEdit && t === "party") setEndTime(addMinutes(startTime, PARTY_MINUTES));
              if (!isEdit && t === "appointment") setEndTime(addMinutes(startTime, 60));
            }}
          >
            {typeChoices.map((t) => (
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
          <Field label="Ημερομηνία" hint={date ? longDateLabel(date) : undefined}>
            <input
              name="date"
              type="date"
              className="input num"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                clearConflicts();
              }}
            />
          </Field>
        </div>
        <Field label="Έναρξη">
          <Time24
            name="startTime"
            value={startTime}
            onChange={(v) => {
              setStartTime(v);
              if (isParty) setEndTime(addMinutes(v, PARTY_MINUTES + (party.extras?.includes("extra_hour") ? 60 : 0)));
              if (type === "appointment") setEndTime(addMinutes(v, 60));
              clearConflicts();
            }}
          />
        </Field>
        <Field label="Λήξη">
          <Time24
            name="endTime"
            value={endTime}
            onChange={(v) => {
              setEndTime(v);
              clearConflicts();
            }}
          />
        </Field>
      </div>
      {isParty && (
        <fieldset className="rounded-xl border border-amber-300/30 bg-amber-300/[0.07] p-3 space-y-3">
          <legend className="px-1 text-sm font-semibold">🎂 Στοιχεία πάρτι</legend>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <Field label="Όνομα παιδιού">
                <input className="input" value={party.childName ?? ""} onChange={(e) => setP({ childName: e.target.value })} placeholder="π.χ. Γιώργος" />
              </Field>
            </div>
            <Field label="Γίνεται (ετών)">
              <input
                type="number"
                min={1}
                max={18}
                inputMode="numeric"
                className="input num"
                value={party.childAge ?? ""}
                onChange={(e) => setP({ childAge: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
            <Field label="Θέμα">
              <input className="input" value={party.theme ?? ""} onChange={(e) => setP({ theme: e.target.value })} placeholder="π.χ. Frozen" />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <Field label="Πακέτο">
                <select className="input" value={party.package ?? ""} onChange={(e) => setP({ package: e.target.value })}>
                  {PARTY_PACKAGES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} · €{p.perChildCents / 100}/παιδί
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Παιδιά">
              <input type="number" min={0} inputMode="numeric" className="input num" value={party.kids ?? 0} onChange={(e) => setP({ kids: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Ενήλικες">
              <input type="number" min={0} inputMode="numeric" className="input num" value={party.adults ?? 0} onChange={(e) => setP({ adults: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Μενού ενηλίκων">
              <select className="input" value={party.adultMenu ?? "none"} onChange={(e) => setP({ adultMenu: e.target.value })}>
                {ADULT_MENUS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Τούρτα">
              <input className="input" value={party.cake ?? ""} onChange={(e) => setP({ cake: e.target.value })} placeholder="π.χ. φέρνουν δική τους / σοκολάτα 2 κιλά" />
            </Field>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Έξτρα</div>
            <div className="flex flex-wrap gap-2">
              {PARTY_EXTRAS.map((x) => {
                const on = party.extras?.includes(x.key) ?? false;
                return (
                  <label key={x.key} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${on ? "bg-amber-300/40 border-amber-400 text-amber-900" : "bg-surface-3 border-line"}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        const extras = on ? (party.extras ?? []).filter((k) => k !== x.key) : [...(party.extras ?? []), x.key];
                        setP({ extras });
                        if (x.key === "extra_hour") setEndTime(addMinutes(startTime, PARTY_MINUTES + (on ? 0 : 60)));
                      }}
                    />
                    {x.name} · €{x.cents / 100}
                  </label>
                );
              })}
            </div>
          </div>
          {quote && (
            <div className="rounded-lg bg-surface-3 border border-line p-3 text-sm">
              <ul className="space-y-0.5">
                {quote.lines.map((l) => (
                  <li key={l.label} className="flex justify-between gap-3">
                    <span>{l.label}</span>
                    <Money cents={l.cents} />
                  </li>
                ))}
              </ul>
              <div className="mt-2 pt-2 border-t border-line flex items-center justify-between gap-3">
                <span className="font-semibold">
                  Πρόταση τιμής: <Money cents={quote.totalCents} />
                </span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setPrice(centsToInput(quote.totalCents))}>
                  Χρήση ως τιμή
                </button>
              </div>
              {isMonToThu(date) && <div className="mt-1 text-xs text-ink-3">Αν η ημέρα είναι αργία, αφαίρεσε την έκπτωση Δευτέρας–Πέμπτης.</div>}
            </div>
          )}
        </fieldset>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!isParty && (
          <Field label={type === "appointment" ? "Άτομα στο ραντεβού" : "Καλεσμένοι"}>
            <input name="guests" type="number" min={0} inputMode="numeric" className="input num" defaultValue={initial?.guests ?? (type === "appointment" ? 2 : 0)} />
          </Field>
        )}
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
          <input name="price" inputMode="decimal" className="input num" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="250,00" />
        </Field>
        <Field label="Προκαταβολή (€)">
          <input name="deposit" inputMode="decimal" className="input num" defaultValue={initial ? centsToInput(initial.depositCents) : ""} placeholder="50,00" />
        </Field>
        <div className="col-span-2 sm:col-span-1 sm:pb-3">
          <Toggle name="depositPaid" defaultChecked={initial?.depositPaid ?? false} label="Πληρώθηκε η προκαταβολή" />
        </div>
      </div>
      <Field label={isParty ? "Σημειώσεις μενού (αλλεργίες κ.λπ.)" : type === "appointment" ? "Θέμα ραντεβού" : "Μενού / πακέτο"}>
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
