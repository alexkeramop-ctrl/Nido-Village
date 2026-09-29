"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { PaymentMethod } from "@/db/schema";
import { Badge, Field, Modal, Money, Numpad, useToast } from "@/components/ui";
import { formatEuro, parseEuroToCents } from "@/server/money";
import type { SessionDto } from "@/components/ops/types";
import {
  DISCOUNT_REASONS,
  ITEM_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  SESSION_STATUS_LABEL,
  SESSION_STATUS_TONE,
  centsToInput,
  fmtDateTime,
  fmtTime,
} from "@/components/ops/labels";
import { openTableAction } from "@/app/pda/actions";
import { addPaymentAction, applyDiscountAction, printBillAction } from "./actions";

const METHODS: PaymentMethod[] = ["cash", "card", "other"];
const QUICK_TENDER = [500, 1000, 2000, 5000, 10000];

function safeCents(v: string): number | null {
  if (!v.trim()) return null;
  try {
    const c = parseEuroToCents(v);
    return c < 0 ? null : c;
  } catch {
    return null;
  }
}

export function PaymentScreen({ session }: { session: SessionDto }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  const [discountOpen, setDiscountOpen] = useState(false);
  const [done, setDone] = useState<{ changeCents: number } | null>(null);
  const closed = session.status === "closed" || session.status === "cancelled";

  const print = () =>
    start(async () => {
      const r = await printBillAction(session.id);
      if (!r.ok) return toast(r.error, "danger");
      toast("Ο λογαριασμός στάλθηκε για εκτύπωση");
    });

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-4 space-y-4 lg:flex lg:items-start lg:gap-4 lg:space-y-0">
      <section className="card p-3 sm:p-4 space-y-3 lg:flex-1 lg:min-w-0">
        <div className="flex items-center gap-2">
          <Link href="/cashier" className="btn-ghost btn-sm px-2" aria-label="Πίσω στο ταμείο">
            ‹ <span className="hidden sm:inline">Ταμείο</span>
          </Link>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight truncate">{session.displayName}</div>
            <div className="text-xs text-ink-3 truncate num">
              {session.waiter} · {fmtTime(session.openedAt)}
              {session.covers > 0 ? ` · ${session.covers} άτ.` : ""}
            </div>
          </div>
          <Badge tone={SESSION_STATUS_TONE[session.status]}>{SESSION_STATUS_LABEL[session.status]}</Badge>
        </div>

        {session.items.length === 0 ? (
          <p className="text-sm text-ink-3 py-4 text-center">Δεν υπάρχουν είδη.</p>
        ) : (
          <ul className="divide-y divide-line">
            {session.items.map((i) => {
              const voided = i.status === "voided";
              return (
                <li key={i.id} className={`py-1.5 flex gap-2 items-start ${voided ? "opacity-50" : ""}`}>
                  <span className={`num w-8 shrink-0 font-semibold ${voided ? "line-through" : ""}`}>{i.qty}×</span>
                  <div className="min-w-0 flex-1">
                    <div className={`leading-snug ${voided ? "line-through" : ""}`}>{i.name}</div>
                    {i.modifiers.length > 0 && <div className="text-xs text-ink-2">{i.modifiers.map((m) => m.name).join(", ")}</div>}
                    {voided && <div className="text-xs text-danger">{ITEM_STATUS_LABEL.voided}</div>}
                  </div>
                  <Money cents={i.lineTotalCents} className={`shrink-0 ${voided ? "line-through" : ""}`} />
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-line pt-2 text-sm space-y-1">
          <div className="flex justify-between text-ink-2">
            <span>Υποσύνολο</span>
            <Money cents={session.totals.subtotalCents} />
          </div>
          {session.totals.discountCents > 0 && (
            <div className="flex justify-between text-warn">
              <span>Έκπτωση{session.discountReason ? ` · ${session.discountReason}` : ""}</span>
              <Money cents={-session.totals.discountCents} />
            </div>
          )}
          <div className="flex justify-between font-bold text-lg">
            <span>Σύνολο</span>
            <Money cents={session.totals.totalCents} />
          </div>
          {session.totals.vat.length > 0 && (
            <table className="w-full text-[11px] text-ink-3 num mt-1">
              <thead>
                <tr>
                  <th className="text-left font-medium">ΦΠΑ</th>
                  <th className="text-right font-medium">Καθαρό</th>
                  <th className="text-right font-medium">ΦΠΑ</th>
                  <th className="text-right font-medium">Μικτό</th>
                </tr>
              </thead>
              <tbody>
                {session.totals.vat.map((v) => (
                  <tr key={v.ratePct}>
                    <td>{v.ratePct}%</td>
                    <td className="text-right">{formatEuro(v.netCents)}</td>
                    <td className="text-right">{formatEuro(v.vatCents)}</td>
                    <td className="text-right">{formatEuro(v.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {session.payments.length > 0 && (
          <div className="border-t border-line pt-2 text-sm space-y-1">
            <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">Πληρωμές</div>
            {session.payments.map((p) => (
              <div key={p.id} className="flex justify-between gap-2">
                <span className="text-ink-2 truncate">
                  {PAYMENT_METHOD_LABEL[p.method]} · <span className="num">{fmtTime(p.createdAt)}</span> · {p.employee}
                  {p.changeCents > 0 ? ` · ρέστα ${formatEuro(p.changeCents)}` : ""}
                </span>
                <Money cents={p.amountCents} className="text-ok font-semibold shrink-0 whitespace-nowrap" />
              </div>
            ))}
          </div>
        )}

        {!closed && !done && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" className="btn-secondary" disabled={pending || session.items.length === 0} onClick={() => setDiscountOpen(true)}>
              Έκπτωση
            </button>
            <button type="button" className="btn-secondary" disabled={pending || session.items.length === 0} onClick={print}>
              Εκτύπωση λογαριασμού
            </button>
          </div>
        )}
      </section>

      <section className="lg:w-96 shrink-0">
        {done ? (
          <DoneCard session={session} changeCents={done.changeCents} onError={(m) => toast(m, "danger")} />
        ) : closed ? (
          <div className="card p-4 space-y-3 text-center">
            <div className="text-lg font-semibold">{session.status === "cancelled" ? "Το τραπέζι ακυρώθηκε" : "Ο λογαριασμός εξοφλήθηκε"}</div>
            {session.closedAt && <div className="text-sm text-ink-3 num">{fmtDateTime(session.closedAt)}</div>}
            <Link href="/cashier" className="btn-primary w-full">
              Πίσω στο ταμείο
            </Link>
          </div>
        ) : (
          <PaymentPanel
            key={`${session.totals.dueCents}-${session.payments.length}`}
            sessionId={session.id}
            dueCents={session.totals.dueCents}
            disabled={session.items.every((i) => i.status === "voided")}
            onClosed={(changeCents) => setDone({ changeCents })}
            onPartial={() => toast("Η πληρωμή καταχωρήθηκε")}
            onError={(m) => toast(m, "danger")}
          />
        )}
      </section>

      {discountOpen && (
        <DiscountModal
          sessionId={session.id}
          subtotalCents={session.totals.subtotalCents}
          currentCents={session.totals.discountCents}
          currentReason={session.discountReason}
          onClose={() => setDiscountOpen(false)}
          onDone={(msg) => {
            setDiscountOpen(false);
            toast(msg);
          }}
          onError={(m) => toast(m, "danger")}
        />
      )}
      {element}
    </div>
  );
}

/* ------------------------------- Πληρωμή ------------------------------- */

function PaymentPanel({
  sessionId,
  dueCents,
  disabled,
  onClosed,
  onPartial,
  onError,
}: {
  sessionId: number;
  dueCents: number;
  disabled: boolean;
  onClosed: (changeCents: number) => void;
  onPartial: () => void;
  onError: (m: string) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountStr, setAmountStr] = useState(centsToInput(dueCents));
  const [tenderStr, setTenderStr] = useState("");
  const [pending, start] = useTransition();

  const amount = safeCents(amountStr);
  const tendered = method === "cash" ? (tenderStr ? safeCents(tenderStr) : amount) : amount;
  const change = amount !== null && tendered !== null ? tendered - amount : null;
  const amountOk = amount !== null && amount > 0 && amount <= dueCents;
  const tenderOk = method !== "cash" || (tendered !== null && amount !== null && tendered >= amount);
  const canPay = !disabled && !pending && amountOk && tenderOk;

  const pay = () => {
    if (!canPay || amount === null) return;
    start(async () => {
      const r = await addPaymentAction(sessionId, { method, amountCents: amount, tenderedCents: method === "cash" ? (tendered ?? amount) : undefined });
      if (!r.ok) return onError(r.error);
      if (r.data.closed) onClosed(r.data.changeCents);
      else onPartial();
    });
  };

  return (
    <div className="card p-3 sm:p-4 space-y-3">
      <div className="flex items-end justify-between">
        <span className="text-ink-2 font-medium">Υπόλοιπο</span>
        <Money cents={dueCents} className="text-3xl font-black" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {METHODS.map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)} className={`${method === m ? "btn-primary" : "btn-secondary"} px-2`}>
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      <div>
        <span className="label">Ποσό πληρωμής</span>
        <div className="flex gap-2">
          <input className="input num text-lg font-semibold" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="0,00" />
          <button type="button" className="btn-secondary btn-sm whitespace-nowrap" onClick={() => setAmountStr(centsToInput(dueCents))}>
            Όλο
          </button>
        </div>
        {amount !== null && amount > dueCents && <div className="text-xs text-danger mt-1">Το ποσό υπερβαίνει το υπόλοιπο.</div>}
        {amount !== null && amount > 0 && amount < dueCents && (
          <div className="text-xs text-ink-3 mt-1">
            Μερική πληρωμή · θα μείνουν <span className="num">{formatEuro(dueCents - amount)}</span>
          </div>
        )}
      </div>

      {method === "cash" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="label mb-0">Δόθηκαν</span>
            <span className="num text-xl font-bold">{tendered === null ? "—" : formatEuro(tendered)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setTenderStr("")}>
              Ακριβώς
            </button>
            {QUICK_TENDER.map((c) => (
              <button key={c} type="button" className="btn-secondary btn-sm num" onClick={() => setTenderStr(centsToInput(c))}>
                {c / 100} €
              </button>
            ))}
          </div>
          <Numpad value={tenderStr} onChange={setTenderStr} mode="amount" disabled={pending} />
          <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${change !== null && change < 0 ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}>
            <span className="font-medium">{change !== null && change < 0 ? "Λείπουν" : "Ρέστα"}</span>
            <span className="num text-2xl font-black">{change === null ? "—" : formatEuro(Math.abs(change))}</span>
          </div>
        </div>
      )}

      <button type="button" className="btn-primary w-full btn-lg" disabled={!canPay} onClick={pay}>
        {pending ? "Καταχώρηση…" : amount !== null && amount > 0 ? `Πληρωμή ${formatEuro(amount)}` : "Πληρωμή"}
      </button>
      {disabled && <p className="text-xs text-ink-3 text-center">Δεν υπάρχουν είδη προς πληρωμή.</p>}
    </div>
  );
}

/* ----------------------------- Ολοκλήρωση ----------------------------- */

function DoneCard({ session, changeCents, onError }: { session: SessionDto; changeCents: number; onError: (m: string) => void }) {
  const [pending, start] = useTransition();
  const reopen = () => {
    if (!session.tableId) return;
    const tableId = session.tableId;
    start(async () => {
      const r = await openTableAction(tableId);
      if (r && !r.ok) onError(r.error);
    });
  };
  return (
    <div className="card p-5 space-y-4 text-center border-ok">
      <div className="text-lg font-semibold text-ok">Ο λογαριασμός εξοφλήθηκε</div>
      <div className="text-ink-2">
        Σύνολο <Money cents={session.totals.totalCents} className="font-semibold" />
      </div>
      {changeCents > 0 && (
        <div className="rounded-2xl bg-ok-soft text-ok py-4">
          <div className="text-sm font-medium">Ρέστα</div>
          <div className="text-4xl font-black num">{formatEuro(changeCents)}</div>
        </div>
      )}
      <Link href="/cashier" className="btn-primary w-full btn-lg">
        Πίσω στο ταμείο
      </Link>
      {session.tableId && (
        <button type="button" className="btn-secondary w-full" disabled={pending} onClick={reopen}>
          {pending ? "Άνοιγμα…" : `Άνοιγμα ξανά: ${session.displayName}`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------- Έκπτωση ------------------------------- */

function DiscountModal({
  sessionId,
  subtotalCents,
  currentCents,
  currentReason,
  onClose,
  onDone,
  onError,
}: {
  sessionId: number;
  subtotalCents: number;
  currentCents: number;
  currentReason: string | null;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState(currentCents ? centsToInput(currentCents) : "");
  const [reason, setReason] = useState(currentReason ?? "");
  const [pending, start] = useTransition();

  const pct = Number(value.replace(",", "."));
  const cents = mode === "amount" ? safeCents(value) : Number.isFinite(pct) && pct >= 0 ? Math.round((subtotalCents * Math.min(100, pct)) / 100) : null;
  const capped = cents === null ? null : Math.min(cents, subtotalCents);
  const canApply = capped !== null && capped > 0 && reason.trim().length > 0 && !pending;

  const apply = (amountCents: number, msg: string) =>
    start(async () => {
      const r = await applyDiscountAction(sessionId, amountCents, reason.trim());
      if (!r.ok) return onError(r.error);
      onDone(msg);
    });

  return (
    <Modal open onClose={onClose} title="Έκπτωση">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <label className={`${mode === "amount" ? "btn-primary" : "btn-secondary"} cursor-pointer`}>
            <input type="radio" name="discount-mode" className="sr-only" checked={mode === "amount"} onChange={() => setMode("amount")} />
            Ποσό (€)
          </label>
          <label className={`${mode === "percent" ? "btn-primary" : "btn-secondary"} cursor-pointer`}>
            <input type="radio" name="discount-mode" className="sr-only" checked={mode === "percent"} onChange={() => setMode("percent")} />
            Ποσοστό (%)
          </label>
        </div>
        <Field label={mode === "amount" ? "Ποσό έκπτωσης (€)" : "Ποσοστό έκπτωσης (%)"}>
          <input className="input num text-lg" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "amount" ? "0,00" : "10"} autoFocus />
        </Field>
        <div className="text-sm text-ink-2 flex justify-between">
          <span>Έκπτωση</span>
          <Money cents={capped ?? 0} className="font-semibold" />
        </div>
        <div className="text-sm text-ink-2 flex justify-between">
          <span>Νέο σύνολο</span>
          <Money cents={subtotalCents - (capped ?? 0)} className="font-bold" />
        </div>
        <div>
          <span className="label">Αιτιολογία (υποχρεωτική)</span>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {DISCOUNT_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={`chip py-1.5 px-3 ${reason === r ? "bg-brand text-white" : "bg-surface-3 text-ink-2"}`}>
                {r}
              </button>
            ))}
          </div>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Γράψε αιτιολογία…" />
        </div>
        <button type="button" className="btn-primary w-full btn-lg" disabled={!canApply} onClick={() => capped !== null && apply(capped, "Η έκπτωση εφαρμόστηκε")}>
          {pending ? "Εφαρμογή…" : "Εφαρμογή έκπτωσης"}
        </button>
        {currentCents > 0 && (
          <button type="button" className="btn-ghost w-full text-danger" disabled={pending} onClick={() => apply(0, "Η έκπτωση αφαιρέθηκε")}>
            Αφαίρεση έκπτωσης
          </button>
        )}
      </div>
    </Modal>
  );
}
