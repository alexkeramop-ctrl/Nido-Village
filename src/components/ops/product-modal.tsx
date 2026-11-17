"use client";
import { useState } from "react";
import { Field, Modal } from "@/components/ui";
import { formatEuro } from "@/server/money";
import type { Menu } from "@/server/services/catalog";
import type { UiLine } from "./cart";

export type MenuProduct = Menu[number]["products"][number];
type ModGroup = MenuProduct["modifierGroups"][number];

/** Επιλογές είδους (π.χ. ζάχαρη, extras) με τους κανόνες ελάχιστων/μέγιστων επιλογών, ποσότητα και σημείωση. Κοινό σε PDA και ταμείο. */
export function ProductModal({
  product,
  courses = 1,
  onClose,
  onAdd,
}: {
  product: MenuProduct;
  /** Πόσα «πιάτα» (σειρά σερβιρίσματος) προσφέρονται. Στο ταμείο self-service: 1 (κρύβεται η επιλογή). */
  courses?: number;
  onClose: () => void;
  onAdd: (line: Omit<UiLine, "key">) => void;
}) {
  const [sel, setSel] = useState<Record<number, number[]>>({});
  const [qty, setQty] = useState(1);
  const [course, setCourse] = useState(1);
  const [notes, setNotes] = useState("");

  const toggle = (g: ModGroup, id: number) =>
    setSel((prev) => {
      const cur = prev[g.id] ?? [];
      if (cur.includes(id)) return { ...prev, [g.id]: cur.filter((x) => x !== id) };
      if (g.maxSelect <= 1) return { ...prev, [g.id]: [id] };
      if (cur.length >= g.maxSelect) return prev;
      return { ...prev, [g.id]: [...cur, id] };
    });

  const valid = product.modifierGroups.every((g) => (sel[g.id]?.length ?? 0) >= g.minSelect);
  const chosen = product.modifierGroups.flatMap((g) => g.modifiers.filter((m) => (sel[g.id] ?? []).includes(m.id)));
  const unit = product.priceCents + chosen.reduce((n, m) => n + m.priceDeltaCents, 0);

  return (
    <Modal open onClose={onClose} title={product.name}>
      <div className="space-y-4">
        {product.modifierGroups.map((g) => (
          <div key={g.id}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="label mb-0">{g.name}</span>
              <span className="text-xs text-ink-3">
                {g.maxSelect <= 1
                  ? g.minSelect > 0
                    ? "υποχρεωτικό"
                    : "προαιρετικό"
                  : `έως ${g.maxSelect}${g.minSelect > 0 ? ` · τουλάχιστον ${g.minSelect}` : ""}`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {g.modifiers.map((m) => {
                const on = (sel[g.id] ?? []).includes(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={on} onClick={() => toggle(g, m.id)} className={`${on ? "btn-primary" : "btn-secondary"} justify-between text-left`}>
                    <span className="truncate">{m.name}</span>
                    {m.priceDeltaCents !== 0 && (
                      <span className="text-xs num opacity-80 shrink-0">
                        {m.priceDeltaCents > 0 ? "+" : ""}
                        {formatEuro(m.priceDeltaCents)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">Ποσότητα</span>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-secondary btn-sm w-11 px-0 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Λιγότερο">
                −
              </button>
              <span className="flex-1 text-center text-xl font-bold num">{qty}</span>
              <button type="button" className="btn-secondary btn-sm w-11 px-0 text-lg" onClick={() => setQty((q) => q + 1)} aria-label="Περισσότερο">
                +
              </button>
            </div>
          </div>
          {courses > 1 && (
            <div>
              <span className="label">Πιάτο (σειρά σερβιρίσματος)</span>
              <div className="flex gap-1">
                {Array.from({ length: courses }, (_, i) => i + 1).map((c) => (
                  <button key={c} type="button" onClick={() => setCourse(c)} className={`${course === c ? "btn-primary" : "btn-secondary"} btn-sm flex-1 px-0`}>
                    {c}ο
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <Field label="Σημείωση">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="π.χ. χωρίς αλάτι" />
        </Field>

        <button
          type="button"
          className="btn-primary w-full btn-lg"
          disabled={!valid}
          onClick={() =>
            onAdd({
              productId: product.id,
              name: product.name,
              unitPriceCents: product.priceCents,
              qty,
              course,
              notes: notes.trim(),
              modifiers: chosen.map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents })),
            })
          }
        >
          Προσθήκη · {formatEuro(unit * qty)}
        </button>
      </div>
    </Modal>
  );
}
