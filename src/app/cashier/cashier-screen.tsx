"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { OrderType, PaymentMethod, SessionSource, SessionStatus } from "@/db/schema";
import { Badge, Field, Modal, Money, Numpad, useToast } from "@/components/ui";
import { parseEuroToCents } from "@/server/money";
import { ORDER_TYPE_TITLE, PAYMENT_METHOD_LABEL, SESSION_STATUS_LABEL, SESSION_STATUS_TONE, fmtDateTime, fmtTime } from "@/components/ops/labels";
import { closeCashShiftAction, markPickedUpAction, markReadyAction, openCashShiftAction } from "./actions";

export type CashierSessionDto = {
  id: number;
  displayName: string;
  orderType: OrderType;
  status: SessionStatus;
  waiter: string;
  openedAt: string;
  minutesOpen: number;
  itemCount: number;
  /** "qr": παραγγελία πελάτη από QR (take away) — δείχνουμε κωδικό παραλαβής και όνομα. */
  source: SessionSource;
  pickupCode: string | null;
  customerName: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  totals: { subtotalCents: number; discountCents: number; totalCents: number; paidCents: number; dueCents: number };
};

export type ShiftDto = {
  id: number;
  openedAt: string;
  openingFloatCents: number;
  byMethod: Record<string, { totalCents: number; count: number }>;
  expectedCashCents: number;
  totalCents: number;
};

export type RecentDto = { id: number; displayName: string; closedAt: string | null; waiter: string; totalCents: number; methods: string[] };

const METHODS: PaymentMethod[] = ["cash", "card", "other"];

function safeCents(v: string): number | null {
  if (!v.trim()) return null;
  try {
    return parseEuroToCents(v);
  } catch {
    return null;
  }
}

export function CashierScreen({ sessions, shift, recent }: { sessions: CashierSessionDto[]; shift: ShiftDto | null; recent: RecentDto[] }) {
  const [bannerOpen, setBannerOpen] = useState(true);
  return (
    <main className="flex-1 p-3 sm:p-4 max-w-7xl w-full mx-auto space-y-4">
      {bannerOpen && (
        <div className="rounded-xl bg-brand-soft/60 border border-brand/20 text-brand-2 text-sm px-3 py-2 flex items-start gap-2">
          <span className="flex-1">Μέχρι τη σύνδεση παρόχου ΑΑΔΕ, η νόμιμη απόδειξη εκδίδεται από την ταμειακή μηχανή.</span>
          <button type="button" className="text-brand-2/70 hover:text-brand-2 px-1" onClick={() => setBannerOpen(false)} aria-label="Κλείσιμο">
            ✕
          </button>
        </div>
      )}

      <div className="lg:flex lg:items-start lg:gap-4 space-y-4 lg:space-y-0">
        <section className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink-2">Ανοιχτοί λογαριασμοί</h2>
            <span className="text-xs text-ink-3 num">{sessions.length}</span>
          </div>
          {sessions.length === 0 ? (
            <div className="card p-8 text-center text-ink-3">Δεν υπάρχουν ανοιχτά τραπέζια ή πακέτα.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {sessions.map((s) => {
                const qr = s.source === "qr";
                const qrReady = qr && !!s.readyAt && !s.pickedUpAt;
                return (
                  <div key={s.id} className="relative">
                    <Link
                      href={`/cashier/s/${s.id}`}
                      className={`card p-3 flex flex-col gap-2 touch transition active:scale-[0.98] ${s.status === "billed" ? "border-warn" : qrReady ? "border-ok" : ""} ${
                        qr && !s.pickedUpAt ? "pb-14" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xl font-bold leading-tight truncate">{s.displayName}</div>
                          <div className="text-xs text-ink-3 truncate">
                            {ORDER_TYPE_TITLE[s.orderType]} · {s.waiter} · <span className="num">{s.minutesOpen}′</span> ·{" "}
                            <span className="num">{s.itemCount}</span> είδη
                          </div>
                        </div>
                        <Badge tone={SESSION_STATUS_TONE[s.status]}>{SESSION_STATUS_LABEL[s.status]}</Badge>
                      </div>
                      {qr && (
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <Badge tone="brand">QR #{s.pickupCode ?? s.id}</Badge>
                          {s.customerName && <span className="text-ink-2 truncate">{s.customerName}</span>}
                          {qrReady && <Badge tone="ok">Έτοιμη</Badge>}
                          {s.pickedUpAt && <Badge>Παραδόθηκε {fmtTime(s.pickedUpAt)}</Badge>}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-ink-3">Σύνολο</div>
                          <Money cents={s.totals.totalCents} className="font-semibold" />
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-ink-3">Πληρωμένα</div>
                          <Money cents={s.totals.paidCents} className={s.totals.paidCents > 0 ? "text-ok font-semibold" : "text-ink-3"} />
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-ink-3">Υπόλοιπο</div>
                          <Money cents={s.totals.dueCents} className="font-bold text-danger" />
                        </div>
                      </div>
                    </Link>
                    {qr && !s.pickedUpAt && <QrActions sessionId={s.id} code={s.pickupCode ?? String(s.id)} ready={!!s.readyAt} />}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="lg:w-80 xl:w-96 shrink-0 space-y-4">
          <ShiftPanel shift={shift} />
          <section className="card p-3 sm:p-4">
            <h2 className="font-semibold text-ink-2 mb-2">Πρόσφατα κλεισμένα</h2>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-3">Κανένα ακόμη.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {recent.map((r) => (
                  <li key={r.id} className="py-1.5 flex items-center gap-2">
                    <Link href={`/cashier/s/${r.id}`} className="font-medium hover:underline">
                      {r.displayName}
                    </Link>
                    <span className="text-xs text-ink-3 truncate">
                      {r.closedAt ? fmtTime(r.closedAt) : ""} · {r.waiter}
                      {r.methods.length ? ` · ${r.methods.map((m) => PAYMENT_METHOD_LABEL[m as PaymentMethod] ?? m).join("/")}` : ""}
                    </span>
                    <Money cents={r.totalCents} className="ml-auto font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

/* ---------------------------- Παραγγελίες QR ---------------------------- */

/** «Έτοιμη» / «Παραδόθηκε» για παραγγελίες QR: εκτός του Link της κάρτας ώστε το πάτημα να μην ανοίγει τον λογαριασμό. */
function QrActions({ sessionId, code, ready }: { sessionId: number; code: string; ready: boolean }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  const markReady = () =>
    start(async () => {
      const r = await markReadyAction(sessionId);
      if (!r.ok) return toast(r.error, "danger");
      toast(`Η #${code} είναι έτοιμη — ειδοποιήθηκε ο πελάτης`);
    });
  const pickedUp = () =>
    start(async () => {
      const r = await markPickedUpAction(sessionId);
      if (!r.ok) return toast(r.error, "danger");
      toast(`Η #${code} παραδόθηκε`);
    });
  return (
    <>
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        {!ready && (
          <button type="button" className="btn btn-sm bg-ok text-white hover:bg-green-800" disabled={pending} onClick={markReady} aria-label={`Έτοιμη η παραγγελία #${code}`}>
            {pending ? "..." : "Έτοιμη"}
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={pickedUp} aria-label={`Παραδόθηκε η παραγγελία #${code}`}>
          {pending ? "..." : "Παραδόθηκε"}
        </button>
      </div>
      {element}
    </>
  );
}

/* ---------------------------- Βάρδια ταμείου ---------------------------- */

function ShiftPanel({ shift }: { shift: ShiftDto | null }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  const [floatValue, setFloatValue] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);

  const openShift = () => {
    const cents = safeCents(floatValue) ?? 0;
    start(async () => {
      const r = await openCashShiftAction(cents);
      if (!r.ok) return toast(r.error, "danger");
      setFloatValue("");
      toast("Η βάρδια άνοιξε");
    });
  };

  return (
    <section className="card p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink-2">Βάρδια ταμείου</h2>
        {shift ? <Badge tone="ok">Ανοιχτή</Badge> : <Badge>Κλειστή</Badge>}
      </div>
      {!shift ? (
        <div className="space-y-3">
          <div>
            <span className="label">Αρχικό ταμείο (ρέστα)</span>
            <div className="h-12 flex items-center justify-end px-3 rounded-xl bg-surface-3 text-2xl font-bold num">{floatValue || "0"} €</div>
          </div>
          <Numpad value={floatValue} onChange={setFloatValue} onSubmit={openShift} mode="amount" submitLabel={pending ? "..." : "Άνοιγμα βάρδιας"} disabled={pending} />
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="text-sm space-y-1">
            <Row label="Άνοιξε" value={fmtDateTime(shift.openedAt)} />
            <Row label="Αρχικό ταμείο" value={<Money cents={shift.openingFloatCents} />} />
            {METHODS.map((m) => (
              <Row
                key={m}
                label={`${PAYMENT_METHOD_LABEL[m]} (${shift.byMethod[m]?.count ?? 0})`}
                value={<Money cents={shift.byMethod[m]?.totalCents ?? 0} />}
              />
            ))}
            <Row label="Σύνολο εισπράξεων" value={<Money cents={shift.totalCents} className="font-semibold" />} />
            <Row label="Αναμενόμενα μετρητά" value={<Money cents={shift.expectedCashCents} className="font-bold text-base" />} />
          </dl>
          <button type="button" className="btn-secondary w-full" onClick={() => setCloseOpen(true)}>
            Κλείσιμο βάρδιας
          </button>
        </div>
      )}
      {closeOpen && shift && <CloseShiftModal shift={shift} onClose={() => setCloseOpen(false)} onError={(m) => toast(m, "danger")} />}
      {element}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function CloseShiftModal({ shift, onClose, onError }: { shift: ShiftDto; onClose: () => void; onError: (m: string) => void }) {
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ expectedCashCents: number; countedCashCents: number; diffCents: number } | null>(null);
  const cents = safeCents(counted);
  const submit = () => {
    if (cents === null) return onError("Δώσε το ποσό που μέτρησες");
    start(async () => {
      const r = await closeCashShiftAction(cents, notes);
      if (!r.ok) return onError(r.error);
      setResult(r.data);
    });
  };
  return (
    <Modal open onClose={onClose} title={result ? "Η βάρδια έκλεισε" : "Κλείσιμο βάρδιας"}>
      {result ? (
        <div className="space-y-4">
          <dl className="space-y-2">
            <Row label="Αναμενόμενα μετρητά" value={<Money cents={result.expectedCashCents} />} />
            <Row label="Μετρημένα" value={<Money cents={result.countedCashCents} />} />
            <Row
              label="Διαφορά"
              value={<Money cents={result.diffCents} className={`font-bold text-lg ${result.diffCents === 0 ? "text-ok" : "text-danger"}`} />}
            />
          </dl>
          <button type="button" className="btn-primary w-full" onClick={onClose}>
            OK
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-ink-2 flex justify-between">
            <span>Αναμενόμενα μετρητά</span>
            <Money cents={shift.expectedCashCents} className="font-semibold" />
          </div>
          <div>
            <span className="label">Μετρημένα μετρητά</span>
            <div className="h-12 flex items-center justify-end px-3 rounded-xl bg-surface-3 text-2xl font-bold num">{counted || "0"} €</div>
            {cents !== null && (
              <div className={`text-xs mt-1 text-right num ${cents - shift.expectedCashCents === 0 ? "text-ok" : "text-danger"}`}>
                Διαφορά: <Money cents={cents - shift.expectedCashCents} />
              </div>
            )}
          </div>
          <Numpad value={counted} onChange={setCounted} mode="amount" disabled={pending} />
          <Field label="Σημειώσεις">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="προαιρετικό" />
          </Field>
          <button type="button" className="btn-danger w-full btn-lg" disabled={pending || cents === null} onClick={submit}>
            {pending ? "Κλείσιμο…" : "Κλείσιμο βάρδιας"}
          </button>
        </div>
      )}
    </Modal>
  );
}
