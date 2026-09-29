"use client";
import { useTransition, type ReactNode } from "react";
import { Modal, useToast } from "@/components/ui";
import type { ActionResult } from "@/server/action";

/* ----------------------------- Δομή σελίδας ----------------------------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, actions, className = "", flush = false }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function InfoBox({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "ok" | "danger" }) {
  const cls = { neutral: "bg-surface-3 text-ink-2", warn: "bg-warn-soft text-warn", ok: "bg-ok-soft text-ok", danger: "bg-danger-soft text-danger" }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-grid">{children}</table>
    </div>
  );
}

/* ------------------------------- Διακόπτης ------------------------------- */

export function Toggle({
  label,
  name,
  checked,
  defaultChecked,
  onChange,
  disabled,
  title,
}: {
  label?: ReactNode;
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  const inputProps = checked === undefined ? { defaultChecked: defaultChecked ?? false } : { checked };
  return (
    <label className={`inline-flex items-center gap-2 select-none ${disabled ? "opacity-50" : "cursor-pointer"}`} title={title}>
      <input
        type="checkbox"
        className="peer sr-only"
        name={name}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        {...inputProps}
      />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-line transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-soft after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

/* ------------------------------ Φόρμα σε Modal ------------------------------ */

export function FormModal({
  open,
  onClose,
  title,
  onSubmit,
  pending,
  submitLabel = "Αποθήκευση",
  wide,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onSubmit: (fd: FormData) => void;
  pending?: boolean;
  submitLabel?: string;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide={wide}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        {children}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {footer}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={pending}>
            Άκυρο
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={pending}>
            {pending ? "Αποθήκευση…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------- Εκτέλεση server actions ------------------------- */

/** Τρέχει ένα server action μέσα σε transition και δείχνει toast για σφάλμα/επιτυχία. */
export function useActionRunner() {
  const { toast, element } = useToast();
  const [pending, startTransition] = useTransition();
  function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onSuccess?: (data: T) => void; onError?: (error: string) => void } = {}) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast(r.error, "danger");
        opts.onError?.(r.error);
        return;
      }
      if (opts.success) toast(opts.success);
      opts.onSuccess?.(r.data);
    });
  }
  return { run, pending, toast, toastElement: element };
}

/* ----------------------------- Ανάγνωση FormData ----------------------------- */

export function formValues(fd: FormData) {
  const raw = (k: string) => fd.get(k);
  const str = (k: string) => String(raw(k) ?? "").trim();
  const num = (k: string, fallback = 0) => {
    const s = str(k).replace(/\s/g, "").replace(",", ".");
    if (!s) return fallback;
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    str,
    strOrNull: (k: string) => str(k) || null,
    num,
    int: (k: string, fallback = 0) => Math.round(num(k, fallback)),
    intOrNull: (k: string) => {
      const s = str(k);
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n) : null;
    },
    bool: (k: string) => raw(k) === "on",
    ints: (k: string) => fd.getAll(k).map((v) => Number(v)).filter((n) => Number.isFinite(n)),
  };
}
