"use client";
import { useState } from "react";

const MONTHS = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];
const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Ημερομηνία με ελληνική σειρά (ημέρα / μήνας / έτος), ανεξάρτητα από τη γλώσσα της συσκευής
 * (το type="date" δείχνει μήνα/ημέρα σε συσκευές με αγγλικά ΗΠΑ). Η τιμή είναι πάντα YYYY-MM-DD.
 */
export function DateGR({
  name,
  value,
  defaultValue,
  onChange,
  compact = false,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  compact?: boolean;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const iso = value ?? inner;
  const [y, m, d] = (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date().toISOString().slice(0, 10)).split("-").map(Number);
  const set = (ny: number, nm: number, nd: number) => {
    const next = `${ny}-${pad(nm)}-${pad(Math.min(nd, daysIn(ny, nm)))}`;
    if (value === undefined) setInner(next);
    onChange?.(next);
  };
  const thisYear = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let i = Math.min(y, thisYear - 2); i <= Math.max(y, thisYear + 4); i++) years.push(i);
  const cls = `input num px-2 ${compact ? "py-1.5" : ""}`;
  return (
    <span className="flex items-center gap-1">
      {name && <input type="hidden" name={name} value={`${y}-${pad(m)}-${pad(d)}`} />}
      {/* «!»: η .input (globals.css, εκτός layer) ορίζει width:100% και νικά το απλό w-auto — τότε ο μήνας στριμώχνεται σε ένα βελάκι. */}
      <select aria-label="Ημέρα" className={`${cls} w-auto! shrink-0`} value={d} onChange={(e) => set(y, m, Number(e.target.value))}>
        {Array.from({ length: daysIn(y, m) }, (_, i) => i + 1).map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <select aria-label="Μήνας" className={`${cls} min-w-0 flex-1`} value={m} onChange={(e) => set(y, Number(e.target.value), d)}>
        {MONTHS.map((x, i) => (
          <option key={x} value={i + 1}>
            {x}
          </option>
        ))}
      </select>
      <select aria-label="Έτος" className={`${cls} w-auto! shrink-0`} value={y} onChange={(e) => set(Number(e.target.value), m, d)}>
        {years.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </span>
  );
}
