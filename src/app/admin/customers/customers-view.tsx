"use client";
import { useMemo, useState } from "react";
import { Badge, EmptyState, Field, Money, Stat } from "@/components/ui";
import { FormModal, InfoBox, PageHeader, Section, TableWrap, Toggle, formValues, useActionRunner } from "@/components/admin/common";
import { fmtDateOnly, fmtIsoDate } from "@/components/admin/format";
import { LiveRefresh } from "@/components/live";
import { BirthdaysSection } from "@/components/admin/bookings/birthdays";
import type { BirthdayRow, CustomerRow } from "@/components/admin/bookings/meta";
import { formatPhone, normalizePhone, telHref, whatsappHref } from "@/lib/phone";
import { deleteCustomerAction, exportCustomersAction, saveCustomerAction, setCustomerConsentAction } from "./actions";

type ModalState = { mode: "new" } | { mode: "edit"; customer: CustomerRow } | null;

/** Αναζήτηση χωρίς τόνους/κεφαλαία ("Μαρια" βρίσκει "Μαρία"). */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("el");
}

/** Κατεβάζει το CSV στον browser (χωρίς αρχείο στον server). */
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CustomersView({
  customers,
  birthdays,
  today,
  isAdmin,
  venueName,
}: {
  customers: CustomerRow[];
  birthdays: BirthdayRow[];
  today: string;
  isAdmin: boolean;
  venueName: string;
}) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [modal, setModal] = useState<ModalState>(null);
  const [modalSeq, setModalSeq] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyConsent, setOnlyConsent] = useState(false);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const digits = normalizePhone(query);
    return customers.filter((c) => {
      if (onlyConsent && !c.marketingConsent) return false;
      if (!q) return true;
      return fold(c.name).includes(q) || (digits.length >= 3 && c.phone.includes(digits)) || fold(c.email ?? "").includes(q) || fold(c.notes ?? "").includes(q);
    });
  }, [customers, query, onlyConsent]);

  const consentCount = customers.filter((c) => c.marketingConsent).length;
  const totalBooked = customers.reduce((a, c) => a + c.totalBookedCents, 0);
  const editing = modal?.mode === "edit" ? modal.customer : null;

  const open = (m: ModalState) => {
    setModalSeq((n) => n + 1);
    setModal(m);
  };

  const submit = (fd: FormData) => {
    const v = formValues(fd);
    run(
      () =>
        saveCustomerAction({
          id: editing?.id,
          name: v.str("name"),
          phone: v.str("phone"),
          email: v.strOrNull("email"),
          notes: v.strOrNull("notes"),
          marketingConsent: v.bool("marketingConsent"),
        }),
      { success: editing ? "Ο πελάτης ενημερώθηκε" : "Ο πελάτης προστέθηκε", onSuccess: () => setModal(null) },
    );
  };

  const setConsent = (c: CustomerRow, consent: boolean) => {
    // Η συγκατάθεση πρέπει να είναι ρητή: ζητείται επιβεβαίωση πριν σημειωθεί.
    if (consent && !window.confirm(`Έδωσε ο πελάτης «${c.name || formatPhone(c.phone)}» ρητή συγκατάθεση να λαμβάνει ενημερώσεις (WhatsApp, SMS, email);`)) return;
    run(() => setCustomerConsentAction(c.id, consent), { success: consent ? "Σημειώθηκε συγκατάθεση για ενημερώσεις" : "Η συγκατάθεση αφαιρέθηκε" });
  };

  const remove = (c: CustomerRow) => {
    if (!window.confirm(`Διαγραφή του πελάτη «${c.name || formatPhone(c.phone)}»; Οι κρατήσεις του μένουν στο ημερολόγιο, αλλά το τηλέφωνο και το email του σβήνονται και από αυτές. Δεν αναιρείται.`)) return;
    run(() => deleteCustomerAction(c.id), { success: "Ο πελάτης διαγράφηκε", onSuccess: () => setModal(null) });
  };

  const exportCsv = (mode: "all" | "marketing") =>
    run(() => exportCustomersAction(mode), {
      onSuccess: (r) => {
        if (!r.count) {
          toast(mode === "marketing" ? "Κανένας πελάτης δεν έχει δώσει συγκατάθεση για ενημερώσεις" : "Δεν υπάρχουν πελάτες για εξαγωγή", "danger");
          return;
        }
        downloadCsv(`${mode === "marketing" ? "pelates-enimeroseis" : "pelatologio"}-${today}.csv`, r.csv);
        toast(`Εξαγωγή ${r.count} ${r.count === 1 ? "πελάτη" : "πελατών"}`);
      },
    });

  const consentToggle = (c: CustomerRow) => (
    <span data-testid="consent-toggle" data-consent={c.marketingConsent ? "yes" : "no"}>
      <Toggle checked={c.marketingConsent} onChange={(v) => setConsent(c, v)} disabled={pending} title={c.marketingConsent && c.consentAt ? `Συγκατάθεση από ${fmtDateOnly(c.consentAt)}` : "Χωρίς συγκατάθεση για ενημερώσεις"} />
    </span>
  );

  return (
    <div className="space-y-4">
      {toastElement}
      <LiveRefresh types={["catalog.changed"]} />
      <PageHeader
        title="Πελατολόγιο"
        subtitle="Οι πελάτες των κρατήσεων. Κάθε κράτηση με τηλέφωνο μπαίνει αυτόματα εδώ."
        actions={
          <>
            <button className="btn-secondary btn-sm" onClick={() => exportCsv("all")} disabled={pending} data-testid="export-all">
              ⬇ CSV (όλοι)
            </button>
            <button className="btn-secondary btn-sm" onClick={() => exportCsv("marketing")} disabled={pending} data-testid="export-marketing" title="Μόνο όσοι έχουν δώσει συγκατάθεση">
              ⬇ CSV για ενημερώσεις
            </button>
            <button className="btn-primary btn-sm" onClick={() => open({ mode: "new" })}>
              + Νέος πελάτης
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Πελάτες" value={customers.length} sub="με τηλέφωνο" />
        <Stat label="Με συγκατάθεση ενημερώσεων" value={consentCount} sub={`από ${customers.length}`} tone={consentCount ? "ok" : undefined} />
        <Stat label="Αξία κρατήσεων" value={<Money cents={totalBooked} />} sub="χωρίς τις ακυρωμένες" />
      </div>

      <InfoBox>
        Η εξαγωγή «CSV για ενημερώσεις» περιέχει <strong>μόνο</strong> όσους έχουν δώσει συγκατάθεση. Άνοιξε τον διακόπτη «Ενημερώσεις» μόνο όταν ο πελάτης το έχει ζητήσει ρητά (στο τηλέφωνο, στο μαγαζί ή από τη φόρμα του site).
      </InfoBox>

      <Section
        flush
        title={
          <span>
            Πελάτες{" "}
            <span className="text-ink-3 font-normal num">
              · {shown.length}
              {shown.length !== customers.length && ` από ${customers.length}`}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Toggle checked={onlyConsent} onChange={setOnlyConsent} label="Μόνο με συγκατάθεση" />
            <div className="w-full sm:w-72">
              <input type="search" className="input" placeholder="Αναζήτηση: όνομα, τηλέφωνο, email" aria-label="Αναζήτηση πελάτη" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        }
      >
        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={customers.length ? "Κανένας πελάτης σε αυτή την αναζήτηση" : "Δεν υπάρχουν πελάτες ακόμη"}
              hint={customers.length ? undefined : "Οι πελάτες δημιουργούνται αυτόματα όταν αποθηκεύεις κράτηση με τηλέφωνο."}
            />
          </div>
        ) : (
          <>
            {/* Κινητό: κάρτες */}
            <ul className="md:hidden divide-y divide-line" data-testid="customer-cards">
              {shown.map((c) => (
                <li key={c.id} className="p-4 space-y-2" data-customer-id={c.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold break-words">{c.name || <span className="text-ink-3">χωρίς όνομα</span>}</div>
                      <div className="text-sm num">
                        <a href={telHref(c.phone) ?? undefined} className="underline decoration-dotted underline-offset-2">
                          {formatPhone(c.phone)}
                        </a>
                      </div>
                      {c.email && <div className="text-xs text-ink-3 break-all">{c.email}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1">Ενημερώσεις</div>
                      {consentToggle(c)}
                    </div>
                  </div>
                  <div className="text-xs text-ink-3 num">
                    {c.bookings} {c.bookings === 1 ? "κράτηση" : "κρατήσεις"}
                    {c.lastBookingDate && ` · τελευταία ${fmtIsoDate(c.lastBookingDate)}`} · <Money cents={c.totalBookedCents} />
                  </div>
                  {c.notes && <div className="text-xs text-ink-2 break-words">{c.notes}</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {whatsappHref(c.phone) && (
                      <a href={whatsappHref(c.phone)!} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                        💬 WhatsApp
                      </a>
                    )}
                    <button className="btn-secondary btn-sm" onClick={() => open({ mode: "edit", customer: c })}>
                      Επεξεργασία
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {/* Υπολογιστής/tablet: πίνακας με ταξινόμηση */}
            <div className="hidden md:block">
              <TableWrap>
                <thead>
                  <tr>
                    <th>Όνομα</th>
                    <th>Τηλέφωνο</th>
                    <th className="text-right">Κρατήσεις</th>
                    <th>Τελευταία κράτηση</th>
                    <th className="text-right">Αξία κρατήσεων</th>
                    <th>Ενημερώσεις</th>
                    <th data-nosort></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} data-customer-id={c.id}>
                      <td>
                        <div className="font-medium">{c.name || <span className="text-ink-3">χωρίς όνομα</span>}</div>
                        {c.email && <div className="text-xs text-ink-3 break-all">{c.email}</div>}
                        {c.notes && <div className="text-xs text-ink-2 max-w-xs truncate" title={c.notes}>{c.notes}</div>}
                      </td>
                      <td className="num whitespace-nowrap" data-sort={c.phone}>
                        <a href={telHref(c.phone) ?? undefined} className="hover:underline">
                          {formatPhone(c.phone)}
                        </a>
                      </td>
                      <td className="text-right num">{c.bookings}</td>
                      <td className="num whitespace-nowrap">{c.lastBookingDate ? fmtIsoDate(c.lastBookingDate) : <span className="text-ink-3">—</span>}</td>
                      <td className="text-right num">
                        <Money cents={c.totalBookedCents} />
                      </td>
                      <td data-sort={c.marketingConsent ? "1" : "0"}>
                        <span className="inline-flex items-center gap-2">
                          {consentToggle(c)}
                          {c.marketingConsent ? <Badge tone="ok">Ναι</Badge> : <Badge>Όχι</Badge>}
                        </span>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-ghost btn-sm" onClick={() => open({ mode: "edit", customer: c })}>
                          Επεξεργασία
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </>
        )}
      </Section>

      <BirthdaysSection rows={birthdays} venueName={venueName} />

      <FormModal
        key={modalSeq}
        open={modal !== null}
        onClose={() => setModal(null)}
        title={editing ? "Επεξεργασία πελάτη" : "Νέος πελάτης"}
        onSubmit={submit}
        pending={pending}
        footer={
          editing && isAdmin ? (
            <button type="button" className="btn-ghost btn-sm text-danger mr-auto" onClick={() => remove(editing)} disabled={pending}>
              Διαγραφή πελάτη
            </button>
          ) : undefined
        }
      >
        <Field label="Ονοματεπώνυμο">
          <input name="name" className="input" required maxLength={120} defaultValue={editing?.name ?? ""} autoFocus />
        </Field>
        <Field label="Τηλέφωνο" hint="Ελληνικό κινητό ή σταθερό (10 ψηφία). Τα κενά, οι παύλες και το +30 αφαιρούνται.">
          <input name="phone" type="tel" inputMode="tel" className="input num" required defaultValue={editing ? formatPhone(editing.phone) : ""} placeholder="691 234 5678" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className="input" maxLength={160} defaultValue={editing?.email ?? ""} />
        </Field>
        <Field label="Σημειώσεις">
          <textarea name="notes" className="input" rows={2} maxLength={1000} defaultValue={editing?.notes ?? ""} placeholder="π.χ. αλλεργίες, προτιμήσεις" />
        </Field>
        <div className="rounded-xl border border-line bg-surface-3 px-3 py-2">
          <Toggle name="marketingConsent" defaultChecked={editing?.marketingConsent ?? false} label="Έχει δώσει συγκατάθεση για ενημερώσεις (WhatsApp, SMS, email)" />
          {editing?.marketingConsent && editing.consentAt && <div className="text-xs text-ink-3 mt-1 num">Συγκατάθεση από {fmtDateOnly(editing.consentAt)}</div>}
        </div>
      </FormModal>
    </div>
  );
}
