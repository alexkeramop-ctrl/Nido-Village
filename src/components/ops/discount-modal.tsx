"use client";
import { useState } from "react";
import { Field, Modal, Money } from "@/components/ui";
import { parseEuroToCents } from "@/server/money";
import { DISCOUNT_REASONS, centsToInput } from "./labels";

function safeCents(v: string): number | null {
  if (!v.trim()) return null;
  try {
    const c = parseEuroToCents(v);
    return c < 0 ? null : c;
  } catch {
    return null;
  }
}

/**
 * Έκπτωση σε ποσό ή ποσοστό, με υποχρεωτική αιτιολογία. Δεν καλεί server: δίνει (λεπτά, αιτία) στο onApply,
 * ώστε να τη χρησιμοποιούν και ο παλιός λογαριασμός και η γρήγορη πώληση του ταμείου.
 */
export function DiscountModal({
  subtotalCents,
  currentCents,
  currentReason,
  pending = false,
  onClose,
  onApply,
}: {
  subtotalCents: number;
  currentCents: number;
  currentReason: string | null;
  pending?: boolean;
  onClose: () => void;
  onApply: (cents: number, reason: string) => void;
}) {
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState(currentCents ? centsToInput(currentCents) : "");
  const [reason, setReason] = useState(currentReason ?? "");

  const pct = Number(value.replace(",", "."));
  const cents = mode === "amount" ? safeCents(value) : Number.isFinite(pct) && pct >= 0 ? Math.round((subtotalCents * Math.min(100, pct)) / 100) : null;
  const capped = cents === null ? null : Math.min(cents, subtotalCents);
  const canApply = capped !== null && capped > 0 && reason.trim().length > 0 && !pending;

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
          <span className="label" id="discount-reason-label">
            Αιτιολογία (υποχρεωτική)
          </span>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {DISCOUNT_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`chip py-1.5 px-3 ${reason === r ? "bg-brand text-white" : "bg-surface-3 text-ink-2"}`}>
                {r}
              </button>
            ))}
          </div>
          <input className="input" aria-labelledby="discount-reason-label" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Γράψε αιτιολογία…" />
        </div>
        <button type="button" className="btn-primary w-full btn-lg" disabled={!canApply} onClick={() => capped !== null && onApply(capped, reason.trim())}>
          {pending ? "Εφαρμογή…" : "Εφαρμογή έκπτωσης"}
        </button>
        {currentCents > 0 && (
          <button type="button" className="btn-ghost w-full text-danger" disabled={pending} onClick={() => onApply(0, "")}>
            Αφαίρεση έκπτωσης
          </button>
        )}
      </div>
    </Modal>
  );
}
