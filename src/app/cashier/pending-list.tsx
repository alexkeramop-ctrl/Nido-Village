"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge, Modal, Money } from "@/components/ui";
import { DiscountModal } from "@/components/ops/discount-modal";
import { fmtTime } from "@/components/ops/labels";
import { formatEuro } from "@/server/money";
import type { TenderInput } from "@/lib/tender";
import type { PendingOrder, SaleResult, TillSnapshot } from "@/server/services/till";
import { handedOverAction, payOrderAtTillAction } from "./actions";
import { PayPanel } from "./pay-panel";

type ReadyRow = TillSnapshot["ready"][number];

/**
 * «Προς πληρωμή»: παραγγελίες που έκαναν οι πελάτες από το κινητό (QR) και περιμένουν είσπραξη,
 * και «Έτοιμες»: πληρωμένες παραγγελίες που περιμένουν τον πελάτη να τις πάρει.
 */
export function OrdersSheet({
  pending,
  ready,
  shiftId,
  canDiscount,
  onClose,
  onPaid,
  onChanged,
  onError,
}: {
  pending: PendingOrder[];
  ready: ReadyRow[];
  shiftId: number;
  canDiscount: boolean;
  onClose: () => void;
  onPaid: (sale: SaleResult) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const selected = pending.find((p) => p.sessionId === selectedId) ?? null;

  const handOver = async (row: ReadyRow) => {
    setBusy(row.sessionId);
    try {
      const r = await handedOverAction(row.sessionId);
      if (!r.ok) onError(r.error);
      else onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={selected ? `Πληρωμή · ${selected.name}` : "Παραγγελίες"} wide>
      {selected ? (
        <PayOrder
          key={selected.sessionId}
          order={selected}
          shiftId={shiftId}
          canDiscount={canDiscount}
          onBack={() => setSelectedId(null)}
          onPaid={(sale) => {
            setSelectedId(null);
            onPaid(sale);
          }}
          onError={onError}
        />
      ) : (
        <div className="space-y-5">
          <section aria-labelledby="pending-title">
            <h3 id="pending-title" className="font-semibold mb-2">
              Προς πληρωμή <span className="num text-ink-3">({pending.length})</span>
            </h3>
            {pending.length === 0 ? (
              <p className="text-sm text-ink-3 rounded-xl bg-surface-3 px-3 py-4 text-center">Καμία παραγγελία δεν περιμένει πληρωμή.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {pending.map((o) => (
                  <li key={o.sessionId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(o.sessionId)}
                      aria-label={`Πληρωμή ${o.name}, ${formatEuro(o.dueCents)}`}
                      className="card w-full p-3 text-left touch transition active:scale-[0.98] hover:bg-white/80"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-lg font-bold leading-tight truncate">{o.name}</span>
                          <span className="block text-xs text-ink-3 num">
                            {fmtTime(o.openedAt)} · {o.itemCount} {o.itemCount === 1 ? "είδος" : "είδη"}
                          </span>
                        </span>
                        <Money cents={o.dueCents} className="text-lg font-black shrink-0" />
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {o.qr ? <Badge tone="brand">QR</Badge> : <Badge>Λογαριασμός</Badge>}
                        {o.ready && <Badge tone="ok">Έτοιμη</Badge>}
                        {o.partial && <Badge tone="warn">Μερική πληρωμή</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ready-title">
            <h3 id="ready-title" className="font-semibold mb-2">
              Έτοιμες για παράδοση <span className="num text-ink-3">({ready.length})</span>
            </h3>
            {ready.length === 0 ? (
              <p className="text-sm text-ink-3">Καμία έτοιμη παραγγελία δεν περιμένει.</p>
            ) : (
              <ul className="divide-y divide-line">
                {ready.map((r) => (
                  <li key={r.sessionId} className="py-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-bold">{r.name}</span>
                      {r.customerName && !r.name.includes(r.customerName) && <span className="text-ink-2"> · {r.customerName}</span>}
                      <span className="text-xs text-ink-3 num"> · έτοιμη {fmtTime(r.readyAt)}</span>
                      {!r.paid && (
                        <span className="ml-1.5">
                          <Badge tone="warn">Απλήρωτη</Badge>
                        </span>
                      )}
                    </span>
                    <button type="button" className="btn-secondary btn-sm" disabled={busy === r.sessionId} onClick={() => handOver(r)} aria-label={`Παραδόθηκε: ${r.name}`}>
                      {busy === r.sessionId ? "…" : "Παραδόθηκε"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function PayOrder({
  order,
  shiftId,
  canDiscount,
  onBack,
  onPaid,
  onError,
}: {
  order: PendingOrder;
  shiftId: number;
  canDiscount: boolean;
  onBack: () => void;
  onPaid: (sale: SaleResult) => void;
  onError: (message: string) => void;
}) {
  const [buzzer, setBuzzer] = useState("");
  const [discount, setDiscount] = useState<{ cents: number; reason: string } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const discountCents = discount ? Math.min(discount.cents, order.subtotalCents) : order.discountCents;
  const dueCents = Math.max(0, order.subtotalCents - discountCents - order.paidCents);

  const pay = async (tender: TenderInput) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      const r = await payOrderAtTillAction({ sessionId: order.sessionId, cashSessionId: shiftId, buzzerNo: buzzer ? Number(buzzer) : null, discount, tender });
      if (!r.ok) return onError(r.error);
      onPaid(r.data);
    } catch {
      onError("Δεν ολοκληρώθηκε (πρόβλημα σύνδεσης). Έλεγξε τη λίστα πριν ξαναπατήσεις.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {order.qr ? <Badge tone="brand">QR{order.code ? ` #${order.code}` : ""}</Badge> : <Badge>Λογαριασμός</Badge>}
          {order.customerName && <span className="font-semibold">{order.customerName}</span>}
          <span className="text-xs text-ink-3 num">{fmtTime(order.openedAt)}</span>
          {order.ready && <Badge tone="ok">Έτοιμη</Badge>}
        </div>
        <ul className="divide-y divide-line text-sm">
          {order.lines.map((l, i) => (
            <li key={i} className="py-1.5 flex gap-2 items-start">
              <span className="num font-bold w-7 shrink-0">{l.qty}×</span>
              <span className="min-w-0 flex-1">
                <span className="block leading-snug">{l.name}</span>
                {l.modifiers.length > 0 && <span className="block text-xs text-ink-2">{l.modifiers.join(", ")}</span>}
                {l.notes && <span className="block text-xs italic text-warn">{l.notes}</span>}
              </span>
              <Money cents={l.lineTotalCents} className="shrink-0" />
            </li>
          ))}
        </ul>
        <div>
          <label className="label" htmlFor="order-buzzer">
            Βομβητής
          </label>
          <input
            id="order-buzzer"
            className="input num text-2xl! font-black text-center border-amber-500/70! bg-amber-50!"
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            placeholder="—"
            value={buzzer}
            onChange={(e) => setBuzzer(e.target.value.replace(/\D/g, "").slice(0, 3))}
          />
          <p className="text-xs text-ink-3 mt-1">Δώσε βομβητή στον πελάτη· η κουζίνα/μπαρ θα τον δει στην παραγγελία.</p>
        </div>
        {!order.qr && (
          <Link href={`/cashier/s/${order.sessionId}`} className="text-sm underline text-ink-2">
            Αναλυτικός λογαριασμός (μερική πληρωμή, εκτύπωση)
          </Link>
        )}
      </div>
      <PayPanel totalCents={dueCents} pending={pending} onConfirm={pay} onBack={onBack} backLabel="Λίστα">
        <div className="text-sm space-y-1">
          {(discountCents > 0 || order.paidCents > 0) && (
            <div className="flex justify-between text-ink-2">
              <span>Υποσύνολο</span>
              <Money cents={order.subtotalCents} />
            </div>
          )}
          {discountCents > 0 && (
            <div className="flex justify-between text-warn">
              <span>Έκπτωση{discount?.reason ? ` · ${discount.reason}` : ""}</span>
              <Money cents={-discountCents} />
            </div>
          )}
          {order.paidCents > 0 && (
            <div className="flex justify-between text-ok">
              <span>Ήδη πληρωμένα</span>
              <Money cents={-order.paidCents} />
            </div>
          )}
          {canDiscount && (
            <button type="button" className="btn-secondary btn-sm w-full" disabled={pending} onClick={() => setDiscountOpen(true)}>
              {discountCents > 0 ? "Αλλαγή έκπτωσης" : "Έκπτωση"}
            </button>
          )}
        </div>
      </PayPanel>
      {discountOpen && (
        <DiscountModal
          subtotalCents={order.subtotalCents - order.paidCents}
          currentCents={discountCents}
          currentReason={discount?.reason ?? null}
          onClose={() => setDiscountOpen(false)}
          onApply={(cents, reason) => {
            setDiscount({ cents, reason });
            setDiscountOpen(false);
          }}
        />
      )}
    </div>
  );
}
