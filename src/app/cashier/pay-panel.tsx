"use client";
import { useState, type ReactNode } from "react";
import { Money, Numpad } from "@/components/ui";
import { formatEuro } from "@/server/money";
import { planTender, quickAmounts, type TenderInput, type TenderPlan } from "@/lib/tender";
import { centsToInput, inputToCents, shortEuro } from "@/components/ops/labels";

type Mode = "cash" | "card" | "split";
const MODES: { key: Mode; label: string }[] = [
  { key: "cash", label: "Μετρητά" },
  { key: "card", label: "Κάρτα" },
  { key: "split", label: "Μοιρασμένη" },
];

/**
 * Πληρωμή ενός ποσού: μετρητά (με γρήγορα ποσά και ρέστα), κάρτα ή μοιρασμένη (μέρος κάρτα, υπόλοιπο μετρητά).
 * Τα ρέστα υπολογίζονται με την ίδια συνάρτηση (planTender) που χρησιμοποιεί ο server. Μία επιβεβαίωση = onConfirm.
 */
export function PayPanel({
  totalCents,
  pending,
  onConfirm,
  onBack,
  backLabel = "Καλάθι",
  title = "Πληρωμή",
  autoFocusAmount = false,
  children,
}: {
  totalCents: number;
  pending: boolean;
  onConfirm: (tender: TenderInput) => void;
  onBack: () => void;
  backLabel?: string;
  title?: string;
  /** Εστίαση στο πεδίο μετρητών όταν ο ταμίας δουλεύει με πληκτρολόγιο (όχι σε αφή: θα άνοιγε το πληκτρολόγιο οθόνης). */
  autoFocusAmount?: boolean;
  /** Επιπλέον γραμμές πάνω από το σύνολο (π.χ. έκπτωση). */
  children?: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("cash");
  const [tenderStr, setTenderStr] = useState("");
  const [cardStr, setCardStr] = useState("");
  const [field, setField] = useState<"tender" | "card">("tender");

  const free = totalCents === 0;
  const card = mode === "card" ? totalCents : mode === "split" ? inputToCents(cardStr) : 0;
  const cash = card === null ? null : totalCents - card;
  const tendered = cash !== null && cash > 0 ? (tenderStr ? inputToCents(tenderStr) : cash) : null;

  let plan: TenderPlan | null = null;
  let error: string | null = null;
  if (mode === "split" && (card === null || card <= 0 || card >= totalCents)) error = "Γράψε το ποσό της κάρτας (μικρότερο από το σύνολο).";
  else if (cash === null || (cash > 0 && tendered === null)) error = "Μη έγκυρο ποσό.";
  else {
    try {
      plan = planTender(totalCents, { cashCents: cash, cardCents: card ?? 0, tenderedCashCents: tendered });
    } catch (e) {
      error = e instanceof Error ? e.message : "Μη έγκυρη πληρωμή";
    }
  }
  const missing = cash !== null && tendered !== null && tendered < cash ? cash - tendered : 0;
  const showCash = !free && mode !== "card" && cash !== null && cash > 0;
  const quick = showCash ? quickAmounts(cash) : [];

  const pick = (m: Mode) => {
    setMode(m);
    setTenderStr("");
    setField(m === "split" ? "card" : "tender");
  };
  const confirm = () => {
    if (pending || !plan || cash === null) return;
    onConfirm({ cashCents: cash, cardCents: card ?? 0, tenderedCashCents: tendered });
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    } else if (e.key === "Escape" && !pending) {
      e.preventDefault();
      onBack();
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Το περιεχόμενο κυλά αν δεν χωρά· τα ρέστα και το κουμπί «Ολοκλήρωση» μένουν πάντα ορατά στο κάτω μέρος. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pb-2">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost btn-sm px-2" onClick={onBack} disabled={pending}>
            ‹ {backLabel}
          </button>
          <h2 className="font-semibold">{title}</h2>
        </div>
        {children}
        <div className="flex items-end justify-between">
          <span className="text-ink-2 font-medium">Σύνολο</span>
          <Money cents={totalCents} className="text-3xl font-black" />
        </div>

        {free ? (
          <p className="rounded-xl bg-surface-3 px-3 py-2 text-sm text-ink-2">Χωρίς χρέωση (έκπτωση 100%). Η παραγγελία θα σταλεί κανονικά.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Τρόπος πληρωμής">
              {MODES.map((m) => (
                <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => pick(m.key)} disabled={pending} className={`${mode === m.key ? "btn-primary" : "btn-secondary"} px-1! text-[15px]!`}>
                  {m.label}
                </button>
              ))}
            </div>

            {mode === "split" && (
              <div>
                <label className="label" htmlFor="pay-card-amount">
                  Ποσό με κάρτα
                </label>
                <input
                  id="pay-card-amount"
                  className={`input num text-xl! font-bold text-right py-2! ${field === "card" ? "border-brand! ring-2 ring-brand-soft" : ""}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={cardStr}
                  onFocus={() => setField("card")}
                  onChange={(e) => {
                    setCardStr(e.target.value);
                    setTenderStr("");
                  }}
                  onKeyDown={onEnter}
                />
                {cash !== null && cash > 0 && card !== null && card > 0 && (
                  <div className="text-xs text-ink-2 mt-1 flex justify-between">
                    <span>Υπόλοιπο με μετρητά</span>
                    <span className="num font-semibold">{formatEuro(cash)}</span>
                  </div>
                )}
              </div>
            )}

            {mode === "card" && <p className="rounded-xl bg-surface-3 px-3 py-2 text-sm text-ink-2">Πέρασε {formatEuro(totalCents)} στο POS και μετά πάτησε «Ολοκλήρωση».</p>}

            {showCash && (
              <div className="space-y-2">
                <div>
                  <label className="label" htmlFor="pay-cash-given">
                    Μετρητά που έδωσε
                  </label>
                  <input
                    id="pay-cash-given"
                    autoFocus={autoFocusAmount}
                    className={`input num text-xl! font-bold text-right py-2! ${field === "tender" ? "border-brand! ring-2 ring-brand-soft" : ""}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={centsToInput(cash ?? 0)}
                    value={tenderStr}
                    onFocus={() => setField("tender")}
                    onChange={(e) => setTenderStr(e.target.value)}
                    onKeyDown={onEnter}
                  />
                </div>
                <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Γρήγορα ποσά">
                  {quick.map((c, i) => (
                    <button
                      key={c}
                      type="button"
                      disabled={pending}
                      aria-pressed={i === 0 ? !tenderStr : inputToCents(tenderStr) === c}
                      className="btn-secondary btn-sm num px-1! whitespace-nowrap"
                      onClick={() => {
                        setTenderStr(i === 0 ? "" : centsToInput(c));
                        setField("tender");
                      }}
                    >
                      {i === 0 ? "Ακριβώς" : shortEuro(c)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(showCash || mode === "split") && (
              <Numpad
                compact
                mode="amount"
                maxLength={8}
                disabled={pending}
                value={mode === "split" && field === "card" ? cardStr : tenderStr}
                onChange={(v) => {
                  if (mode === "split" && field === "card") {
                    setCardStr(v);
                    setTenderStr("");
                  } else setTenderStr(v);
                }}
              />
            )}
          </>
        )}
      </div>

      <div className="shrink-0 space-y-2 pt-1">
        {showCash && (
          <div role="status" aria-live="polite" className={`flex items-center justify-between rounded-xl px-3 py-2 ${missing > 0 ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}>
            <span className="font-semibold">{missing > 0 ? "Λείπουν" : "Ρέστα"}</span>
            <span className="num text-3xl font-black">{formatEuro(missing > 0 ? missing : (plan?.changeCents ?? 0))}</span>
          </div>
        )}
        {!free && error && missing === 0 && <p className="text-sm text-danger">{error}</p>}
        <button type="button" className="btn-primary w-full btn-lg" disabled={pending || !plan} onClick={confirm}>
          {pending ? "Καταχώρηση…" : "Ολοκλήρωση"}
        </button>
      </div>
    </div>
  );
}
