"use client";

export function PrintButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <button type="button" className="btn-primary btn-sm" disabled={disabled} onClick={() => window.print()}>
      Εκτύπωση
    </button>
  );
}
