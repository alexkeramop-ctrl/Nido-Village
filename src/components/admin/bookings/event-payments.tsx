"use client";
import { useEffect, useState } from "react";
import { Badge, Modal, Money } from "@/components/ui";
import { InfoBox, useActionRunner } from "@/components/admin/common";
import { DateGR } from "@/components/admin/date-gr";
import { centsToInput, fmtIsoDate } from "@/components/admin/format";
import { parseEuroToCents } from "@/server/money";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABEL,
  type BookingPayment,
  type BookingPaymentMethod,
  type BookingPaymentType,
  type PaySummary,
} from "@/components/admin/bookings/meta";
import { deletePaymentAction, eventPaymentsAction, recordPaymentAction } from "@/app/admin/bookings-due/actions";

type Runner = Pick<ReturnType<typeof useActionRunner>, "run" | "pending" | "toast">;
type Detail = { summary: PaySummary; payments: BookingPayment[]; status: string };

/**
 * Πληρωμές μιας κράτησης: τιμή, εισπράξεις, υπόλοιπο, λίστα πληρωμών και «Καταχώρηση πληρωμής».
 * Δεν περιέχει <form>, ώστε να μπαίνει και μέσα στη φόρμα της κράτησης.
 */
export function EventPaymentsPanel({
  eventId,
  agreedDepositCents = 0,
  today,
  isAdmin,
  runner,
}: {
  eventId: number;
  /** Η συμφωνημένη προκαταβολή της κράτησης (προτείνεται ως ποσό στην πρώτη πληρωμή). */
  agreedDepositCents?: number;
  today: string;
  isAdmin: boolean;
  runner: Runner;
}) {
  const { run, pending, toast } = runner;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<BookingPaymentMethod>("cash");
  const [type, setType] = useState<BookingPaymentType>("deposit");
  const [note, setNote] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    eventPaymentsAction(eventId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setDetail({ summary: r.data.summary, payments: r.data.payments, status: r.data.status });
        setError(null);
      } else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [eventId, version]);

  const s = detail?.summary;
  const cancelled = detail?.status === "cancelled";

  function startPayment() {
    if (!s) return;
    const nothingPaid = s.paidCents === 0;
    const suggested = s.priceCents > 0 ? (nothingPaid && agreedDepositCents > 0 ? Math.min(agreedDepositCents, s.balanceCents) : s.balanceCents) : nothingPaid ? agreedDepositCents : 0;
    setType(nothingPaid && (s.priceCents === 0 || suggested < s.balanceCents) ? "deposit" : "settlement");
    setAmount(suggested > 0 ? centsToInput(suggested) : "");
    setDate(today);
    setNote("");
    setOpen(true);
  }

  function submit() {
    let amountCents = 0;
    try {
      amountCents = parseEuroToCents(amount || "0");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Μη έγκυρο ποσό", "danger");
      return;
    }
    if (amountCents <= 0) {
      toast("Γράψε το ποσό της πληρωμής", "danger");
      return;
    }
    run(() => recordPaymentAction({ eventId, date, amountCents, method, type, note }), {
      success: "Η πληρωμή καταχωρήθηκε",
      onSuccess: (r) => {
        setWarning(r.warning);
        setOpen(false);
        setVersion((v) => v + 1);
      },
    });
  }

  function remove(p: BookingPayment) {
    if (!window.confirm(`Διαγραφή της πληρωμής ${fmtIsoDate(p.date)} (${centsToInput(p.amountCents)} €); Θα σβηστεί και από τα Έσοδα – Έξοδα.`)) return;
    run(() => deletePaymentAction(eventId, p.id), { success: "Η πληρωμή διαγράφηκε", onSuccess: () => setVersion((v) => v + 1) });
  }

  if (error) return <InfoBox tone="danger">{error}</InfoBox>;
  if (!s || !detail) return <div className="rounded-xl border border-line bg-surface-3 p-3 text-sm text-ink-3">Φόρτωση πληρωμών…</div>;

  return (
    <div className="rounded-xl border border-line bg-white/60 p-3 space-y-3" data-testid="event-payments">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">💶 Πληρωμές</div>
        {s.state === "paid" && <Badge tone="ok">Εξοφλημένο</Badge>}
        {s.state === "partial" && <Badge tone="warn">Υπόλοιπο</Badge>}
        {s.state === "unpaid" && <Badge tone="danger">Χωρίς πληρωμή</Badge>}
        {s.state === "free" && <Badge>Χωρίς τιμή</Badge>}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface-3 px-2 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Συμφωνημένη τιμή</dt>
          <dd className="font-semibold num" data-testid="pay-price">
            {s.priceCents > 0 ? <Money cents={s.priceCents} /> : "—"}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-3 px-2 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Εισπράχθηκαν</dt>
          <dd className="font-semibold num text-ok" data-testid="pay-paid">
            <Money cents={s.paidCents} />
          </dd>
        </div>
        <div className="rounded-lg bg-surface-3 px-2 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Υπόλοιπο</dt>
          <dd className={`font-semibold num ${s.balanceCents > 0 ? "text-danger" : ""}`} data-testid="pay-balance">
            {s.priceCents > 0 ? <Money cents={s.balanceCents} /> : "—"}
          </dd>
        </div>
      </dl>

      {detail.payments.length > 0 || s.legacyDepositCents > 0 ? (
        <ul className="divide-y divide-line text-sm" data-testid="payment-list">
          {s.legacyDepositCents > 0 && (
            <li className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
              <span className="font-medium">Προκαταβολή (παλιά σημείωση)</span>
              <span className="text-xs text-ink-3">δεν έχει περαστεί στα έσοδα· αν την καταχωρήσεις ως «Προκαταβολή», η παλιά σημείωση παύει να μετράει</span>
              <Money cents={s.legacyDepositCents} className="ml-auto font-semibold" />
            </li>
          )}
          {detail.payments.map((p) => (
            <li key={p.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-payment-id={p.id}>
              <span className="num">{fmtIsoDate(p.date)}</span>
              <Badge tone={p.type === "deposit" ? "brand" : "ok"}>{PAYMENT_TYPE_LABEL[p.type]}</Badge>
              <span className="text-ink-2">{PAYMENT_METHOD_LABEL[p.method as BookingPaymentMethod] ?? p.method}</span>
              {p.note && <span className="text-ink-3 min-w-0 break-words">{p.note}</span>}
              <span className="ml-auto flex items-center gap-2">
                <Money cents={p.amountCents} className="font-semibold" />
                {isAdmin && (
                  <button type="button" className="btn-ghost btn-sm text-danger px-2 py-1" disabled={pending} onClick={() => remove(p)} aria-label={`Διαγραφή πληρωμής ${fmtIsoDate(p.date)}`}>
                    Διαγραφή
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-3">Δεν έχει καταχωρηθεί πληρωμή.</div>
      )}

      {warning && <InfoBox tone="warn">{warning}</InfoBox>}

      {cancelled ? (
        <div className="text-xs text-ink-3">Η κράτηση είναι ακυρωμένη: δεν καταχωρούνται νέες πληρωμές.</div>
      ) : s.state === "paid" ? (
        <div className="text-xs text-ink-3">Η κράτηση έχει εξοφληθεί.</div>
      ) : !open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={startPayment} disabled={pending}>
            + Καταχώρηση πληρωμής
          </button>
          {s.state === "free" && <span className="text-xs text-warn">Η κράτηση δεν έχει τιμή: δεν θα υπολογίζεται υπόλοιπο.</span>}
        </div>
      ) : (
        <div
          className="rounded-lg border border-line bg-surface-3 p-3 space-y-3"
          data-testid="payment-form"
          onKeyDown={(e) => {
            // Μέσα στη φόρμα της κράτησης το Enter θα αποθήκευε την κράτηση· εδώ καταχωρεί την πληρωμή.
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
              e.stopPropagation();
              submit();
            }
          }}
        >
          <div className="text-sm font-semibold">Καταχώρηση πληρωμής</div>
          <div>
            <span className="label">Ημερομηνία</span>
            <DateGR value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="label">Ποσό (€)</span>
              <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50,00" aria-label="Ποσό πληρωμής" autoFocus />
            </label>
            <label className="block">
              <span className="label">Τρόπος</span>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as BookingPaymentMethod)} aria-label="Τρόπος πληρωμής">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Είδος</span>
              <select className="input" value={type} onChange={(e) => setType(e.target.value as BookingPaymentType)} aria-label="Είδος πληρωμής">
                {PAYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PAYMENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {s.priceCents > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {agreedDepositCents > 0 && agreedDepositCents < s.balanceCents && (
                <button
                  type="button"
                  className="rounded-full border border-line bg-white/70 px-3 py-1 hover:bg-white"
                  onClick={() => {
                    setAmount(centsToInput(agreedDepositCents));
                    setType("deposit");
                  }}
                >
                  Προκαταβολή <Money cents={agreedDepositCents} />
                </button>
              )}
              <button
                type="button"
                className="rounded-full border border-line bg-white/70 px-3 py-1 hover:bg-white"
                onClick={() => {
                  setAmount(centsToInput(s.balanceCents));
                  setType("settlement");
                }}
              >
                Όλο το υπόλοιπο <Money cents={s.balanceCents} />
              </button>
            </div>
          )}
          <label className="block">
            <span className="label">Σημείωση (προαιρετικά)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="π.χ. έμβασμα Πειραιώς, απόδειξη 123" aria-label="Σημείωση πληρωμής" />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)} disabled={pending}>
              Άκυρο
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={pending} data-testid="payment-submit">
              {pending ? "Καταχώρηση…" : "Καταχώρηση"}
            </button>
          </div>
          <div className="text-xs text-ink-3">Η πληρωμή γράφεται και στα «Έσοδα – Έξοδα» ως {type === "deposit" ? "«Προκαταβολή εκδήλωσης»" : "«Εξόφληση εκδήλωσης»"}.</div>
        </div>
      )}
    </div>
  );
}

/** Οι πληρωμές μιας κράτησης σε δικό τους παράθυρο (από τη λίστα του ημερολογίου και τις οφειλές). */
export function EventPaymentsModal({
  event,
  today,
  isAdmin,
  onClose,
}: {
  event: { id: number; title: string; date: string; depositCents?: number } | null;
  today: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const runner = useActionRunner();
  return (
    <>
      {runner.toastElement}
      <Modal open={event !== null} onClose={onClose} title={event ? `Πληρωμές: ${event.title}` : undefined} wide>
        {event && (
          <div className="space-y-3">
            <div className="text-sm text-ink-3 num">Ημερομηνία εκδήλωσης: {fmtIsoDate(event.date)}</div>
            <EventPaymentsPanel key={event.id} eventId={event.id} agreedDepositCents={event.depositCents ?? 0} today={today} isAdmin={isAdmin} runner={runner} />
            <div className="flex justify-end">
              <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
                Κλείσιμο
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
