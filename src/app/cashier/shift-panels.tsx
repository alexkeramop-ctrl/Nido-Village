"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Field, Modal, Money, Numpad, useToast } from "@/components/ui";
import { fmtDateTime, fmtTime, inputToCents } from "@/components/ops/labels";
import type { ShiftDto } from "@/server/services/registers";
import { closeShiftAction, openShiftAction, selectRegisterAction } from "./actions";

export type RegisterDto = { id: number; name: string; openShift: { openedAt: string; openedBy: string } | null };

/* ------------------------------ Επιλογή ταμείου ------------------------------ */

/** Πρώτη φορά σε μια συσκευή: ποιο ταμείο είναι; Η επιλογή θυμάται (cookie) ώστε το tablet να ανοίγει πάντα στο ταμείο του. */
export function RegisterPicker({ registers, isAdmin }: { registers: RegisterDto[]; isAdmin: boolean }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<number | null>(null);
  const pick = (id: number) => {
    setPicked(id);
    start(async () => {
      const r = await selectRegisterAction(id);
      if (!r.ok) {
        toast(r.error, "danger");
        setPicked(null);
      }
    });
  };
  return (
    <main className="flex-1 w-full max-w-3xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ποιο ταμείο είναι αυτό;</h1>
        <p className="text-sm text-ink-2 mt-1">Διάλεξε το ταμείο αυτής της συσκευής. Θα το θυμάται την επόμενη φορά.</p>
      </div>
      {registers.length === 0 ? (
        <div className="card p-6 text-center text-ink-2">
          Δεν υπάρχει ενεργό ταμείο.{" "}
          {isAdmin ? (
            <Link href="/admin/settings" className="underline font-semibold">
              Πρόσθεσε ένα στις Ρυθμίσεις
            </Link>
          ) : (
            "Ζήτησε από τον διαχειριστή να ενεργοποιήσει ένα από τις Ρυθμίσεις."
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {registers.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(r.id)}
                className="card w-full p-5 text-left touch transition active:scale-[0.98] disabled:opacity-60 hover:bg-white/80"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-black tracking-tight">{r.name}</span>
                  {r.openShift ? <Badge tone="ok">Ανοιχτή βάρδια</Badge> : <Badge>Κλειστό</Badge>}
                </span>
                <span className="block text-sm text-ink-2 mt-1">
                  {picked === r.id ? "Άνοιγμα…" : r.openShift ? `Άνοιξε ${r.openShift.openedBy} στις ${fmtTime(r.openShift.openedAt)}` : "Δεν έχει ανοίξει βάρδια"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && registers.length > 0 && (
        <p className="text-sm text-ink-3">
          Προσθήκη ή μετονομασία ταμείων:{" "}
          <Link href="/admin/settings" className="underline">
            Ρυθμίσεις
          </Link>
        </p>
      )}
      {element}
    </main>
  );
}

/* ------------------------------ Άνοιγμα βάρδιας ------------------------------ */

export function OpenShiftPanel({ register, canSwitch }: { register: { id: number; name: string }; canSwitch: boolean }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  const [value, setValue] = useState("");
  const cents = value.trim() ? inputToCents(value) : 0;
  const open = () => {
    if (cents === null) return toast("Μη έγκυρο ποσό", "danger");
    start(async () => {
      const r = await openShiftAction(register.id, cents);
      if (!r.ok) toast(r.error, "danger");
    });
  };
  const change = () =>
    start(async () => {
      const r = await selectRegisterAction(null);
      if (!r.ok) toast(r.error, "danger");
    });
  return (
    <main className="flex-1 w-full max-w-md mx-auto p-4">
      <section className="card p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black tracking-tight">{register.name}</h1>
            <p className="text-sm text-ink-2">Η βάρδια είναι κλειστή. Μέτρησε τα ρέστα του συρταριού και άνοιξε.</p>
          </div>
          <Badge>Κλειστό</Badge>
        </div>
        <Field label="Αρχικό ταμείο (ρέστα) σε €">
          <input
            className="input num text-2xl! font-bold text-right"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") open();
            }}
          />
        </Field>
        <Numpad value={value} onChange={setValue} onSubmit={open} mode="amount" maxLength={8} submitLabel={pending ? "Άνοιγμα…" : `Άνοιγμα βάρδιας · ${register.name}`} disabled={pending} />
        {canSwitch && (
          <button type="button" className="btn-ghost w-full btn-sm" onClick={change} disabled={pending}>
            Αλλαγή ταμείου
          </button>
        )}
      </section>
      {element}
    </main>
  );
}

/* ------------------------------ Στοιχεία βάρδιας ------------------------------ */

function Row({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-bold text-base" : ""}`}>
      <dt className={strong ? "" : "text-ink-2"}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

export function diffLabel(diffCents: number): string {
  return diffCents === 0 ? "Συμφωνεί" : diffCents > 0 ? "Πλεόνασμα" : "Έλλειμμα";
}

export function ShiftFigures({ shift }: { shift: ShiftDto }) {
  return (
    <dl className="text-sm space-y-1.5">
      <Row label="Πωλήσεις" value={shift.salesCount} />
      <Row label={`Μετρητά (${shift.byMethod.cash.count})`} value={<Money cents={shift.byMethod.cash.totalCents} />} />
      <Row label={`Κάρτα (${shift.byMethod.card.count})`} value={<Money cents={shift.byMethod.card.totalCents} />} />
      {(shift.byMethod.other.count > 0 || shift.byMethod.other.totalCents > 0) && <Row label={`Άλλο (${shift.byMethod.other.count})`} value={<Money cents={shift.byMethod.other.totalCents} />} />}
      <Row label="Σύνολο εισπράξεων" value={<Money cents={shift.totalCents} />} strong />
      <div className="border-t border-line my-1.5" />
      <Row label="Αρχικό ταμείο" value={<Money cents={shift.openingFloatCents} />} />
      <Row label="Αναμενόμενα μετρητά στο συρτάρι" value={<Money cents={shift.expectedCashCents} />} strong />
    </dl>
  );
}

/* ------------------------------ Κλείσιμο ταμείου ------------------------------ */

export function CloseShiftModal({ shift, blocked, onClose, onClosed }: { shift: ShiftDto; blocked: string | null; onClose: () => void; onClosed: (final: ShiftDto) => void }) {
  const { toast, element } = useToast();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const cents = counted.trim() ? inputToCents(counted) : null;
  const diff = cents === null ? null : cents - shift.expectedCashCents;
  const submit = () => {
    if (cents === null) return toast("Γράψε τα μετρητά που μέτρησες", "danger");
    start(async () => {
      const r = await closeShiftAction(shift.id, cents, notes);
      if (!r.ok) return toast(r.error, "danger");
      onClosed(r.data);
    });
  };
  return (
    <Modal open onClose={onClose} title={`Κλείσιμο ταμείου · ${shift.registerName}`} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-3">
          <p className="text-xs text-ink-3">
            Βάρδια από <span className="num">{fmtDateTime(shift.openedAt)}</span> · {shift.openedBy}
          </p>
          <ShiftFigures shift={shift} />
          {blocked && <p className="rounded-xl bg-warn-soft text-warn px-3 py-2 text-sm font-medium">{blocked}</p>}
        </div>
        <div className="space-y-3">
          <Field label="Μετρητά που μέτρησες στο συρτάρι (€)">
            <input
              className="input num text-2xl! font-bold text-right"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </Field>
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center justify-between rounded-xl px-3 py-2 ${diff === null ? "bg-surface-3 text-ink-2" : diff === 0 ? "bg-ok-soft text-ok" : diff > 0 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger"}`}
          >
            <span className="font-semibold">{diff === null ? "Διαφορά" : diffLabel(diff)}</span>
            <span className="num text-2xl font-black">{diff === null ? "—" : <Money cents={Math.abs(diff)} />}</span>
          </div>
          <Numpad compact value={counted} onChange={setCounted} mode="amount" maxLength={9} disabled={pending} />
          <Field label="Σημειώσεις (προαιρετικό)">
            <input className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="π.χ. λάθος ρέστα σε πελάτη" />
          </Field>
          <button type="button" className="btn-danger w-full btn-lg" disabled={pending || cents === null || !!blocked} onClick={submit}>
            {pending ? "Κλείσιμο…" : "Κλείσιμο ταμείου"}
          </button>
        </div>
      </div>
      {element}
    </Modal>
  );
}

/** Το αποτέλεσμα του κλεισίματος: εκτυπώσιμο (Εκτύπωση -> χαρτί ή PDF). */
export function ShiftReport({ shift }: { shift: ShiftDto }) {
  const router = useRouter();
  const [leaving, start] = useTransition();
  const diff = shift.diffCents ?? 0;
  return (
    <main className="flex-1 w-full max-w-md mx-auto p-4">
      <style>{`@media print { header, nav, .print\\:hidden { display: none !important; } body { background: #fff; } .card { box-shadow: none; border: none; } }`}</style>
      <section className="card p-5 space-y-4" aria-label="Σύνοψη βάρδιας">
        <div>
          <div className="text-xs uppercase tracking-widest text-ink-3 font-semibold">Κλείσιμο ταμείου</div>
          <h1 className="text-2xl font-black tracking-tight">{shift.registerName}</h1>
          <p className="text-sm text-ink-2 num">
            {fmtDateTime(shift.openedAt)} – {shift.closedAt ? fmtDateTime(shift.closedAt) : ""}
          </p>
          <p className="text-sm text-ink-2">
            Άνοιξε: {shift.openedBy}
            {shift.closedBy ? ` · Έκλεισε: ${shift.closedBy}` : ""}
          </p>
        </div>
        <ShiftFigures shift={shift} />
        <dl className="text-sm space-y-1.5">
          <Row label="Μετρημένα μετρητά" value={<Money cents={shift.countedCashCents ?? 0} />} strong />
        </dl>
        <div className={`flex items-center justify-between rounded-xl px-3 py-3 ${diff === 0 ? "bg-ok-soft text-ok" : diff > 0 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger"}`}>
          <span className="font-bold">Διαφορά · {diffLabel(diff)}</span>
          <span className="num text-2xl font-black" data-testid="shift-diff">
            {diff > 0 ? "+" : diff < 0 ? "−" : ""}
            <Money cents={Math.abs(diff)} />
          </span>
        </div>
        {shift.notes && <p className="text-sm text-ink-2">Σημειώσεις: {shift.notes}</p>}
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            Εκτύπωση
          </button>
          <button type="button" className="btn-primary" disabled={leaving} onClick={() => start(() => router.refresh())}>
            {leaving ? "…" : "Τέλος"}
          </button>
        </div>
      </section>
    </main>
  );
}
