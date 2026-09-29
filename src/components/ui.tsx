"use client";
import { formatEuro } from "@/server/money";
import { useEffect, useState, type ReactNode } from "react";

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`num ${className}`}>{formatEuro(cents)}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "brand" }) {
  const cls = {
    neutral: "bg-surface-3 text-ink-2",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    brand: "bg-brand-soft text-brand-2",
  }[tone];
  return <span className={`chip ${cls}`}>{children}</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className={`bg-surface-2 w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-md"} rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-line">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Κλείσιμο">
              ✕
            </button>
          </div>
        )}
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** Αριθμητικό πληκτρολόγιο αφής. mode "pin" κρύβει τα ψηφία, "amount" γράφει ευρώ με 2 δεκαδικά. */
export function Numpad({
  value,
  onChange,
  onSubmit,
  mode = "amount",
  submitLabel = "OK",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  mode?: "pin" | "amount" | "int";
  submitLabel?: string;
  disabled?: boolean;
}) {
  const press = (k: string) => {
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === "C") return onChange("");
    if (k === "," && (mode !== "amount" || value.includes(","))) return;
    if (mode === "pin" && value.length >= 8) return;
    if (mode === "amount" && value.includes(",") && value.split(",")[1].length >= 2) return;
    onChange(value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", mode === "amount" ? "," : "C", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-2 touch">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => press(k)}
          className="btn-secondary text-2xl py-4 rounded-2xl"
        >
          {k}
        </button>
      ))}
      {onSubmit && (
        <button type="button" disabled={disabled} onClick={onSubmit} className="btn-primary col-span-3 text-lg py-4 rounded-2xl">
          {submitLabel}
        </button>
      )}
    </div>
  );
}

export function Toast({ message, tone = "ok", onDone }: { message: string | null; tone?: "ok" | "danger"; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${tone === "ok" ? "bg-ok" : "bg-danger"}`}>
      {message}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ message: string; tone: "ok" | "danger" } | null>(null);
  return {
    toast: (message: string, tone: "ok" | "danger" = "ok") => setMsg({ message, tone }),
    element: <Toast message={msg?.message ?? null} tone={msg?.tone} onDone={() => setMsg(null)} />,
  };
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-8 text-center text-ink-3">
      <div className="text-lg font-medium text-ink-2">{title}</div>
      {hint && <div className="text-sm mt-1">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-ink-3 font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-1 num ${color}`}>{value}</div>
      {sub && <div className="text-xs text-ink-3 mt-1">{sub}</div>}
    </div>
  );
}
