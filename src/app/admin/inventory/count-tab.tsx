"use client";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { InfoBox, Section, TableWrap, useActionRunner } from "@/components/admin/common";
import { fmtQty, parseDecimal } from "@/components/admin/format";
import { stockCountAction } from "./actions";
import type { Ingredient } from "./types";

type CountResult = { ingredientId: number; before: number; after: number; delta: number };

export function CountTab({ ingredients }: { ingredients: Ingredient[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [results, setResults] = useState<CountResult[] | null>(null);
  const [search, setSearch] = useState("");

  const valueOf = (i: Ingredient) => counted[i.id] ?? fmtQty(i.stock);
  const changed = ingredients.filter((i) => counted[i.id] !== undefined && counted[i.id].trim() !== "" && parseDecimal(counted[i.id]) !== i.stock);
  const q = search.trim().toLowerCase();
  const rows = q ? ingredients.filter((i) => i.name.toLowerCase().includes(q)) : ingredients;
  const nameOf = (id: number) => ingredients.find((i) => i.id === id);

  const submit = () => {
    const lines = changed.map((i) => ({ ingredientId: i.id, countedQty: parseDecimal(counted[i.id]) }));
    run(() => stockCountAction(lines, note), {
      success: `Η απογραφή καταχωρήθηκε (${lines.length} είδη)`,
      onSuccess: (res) => {
        setResults(res);
        setCounted({});
        setNote("");
      },
    });
  };

  return (
    <div className="space-y-4">
      {toastElement}
      <InfoBox>
        Συμπλήρωσε τη μετρημένη ποσότητα μόνο στα είδη που διαφέρουν. Με την καταχώρηση, το απόθεμα ορίζεται στη μετρημένη τιμή και η διαφορά
        καταγράφεται ως κίνηση «Απογραφή».
      </InfoBox>

      {results && results.length > 0 && (
        <Section title="Αποτέλεσμα απογραφής" actions={<button className="btn-ghost btn-sm" onClick={() => setResults(null)}>Κλείσιμο</button>} flush>
          <TableWrap>
            <thead>
              <tr>
                <th>Πρώτη ύλη</th>
                <th className="text-right">Πριν</th>
                <th className="text-right">Μετρήθηκε</th>
                <th className="text-right">Διαφορά</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const ing = nameOf(r.ingredientId);
                return (
                  <tr key={r.ingredientId}>
                    <td className="font-medium">{ing?.name ?? `#${r.ingredientId}`}</td>
                    <td className="text-right num">{fmtQty(r.before)}</td>
                    <td className="text-right num">{fmtQty(r.after)}</td>
                    <td className={`text-right num font-semibold ${r.delta > 0 ? "text-ok" : r.delta < 0 ? "text-danger" : "text-ink-3"}`}>
                      {fmtQty(r.delta, true)} {ing?.unitLabel ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Section>
      )}

      <Section
        title="Απογραφή"
        actions={
          <>
            <input className="input" placeholder="Αναζήτηση…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Αναζήτηση" />
          </>
        }
        flush
      >
        <TableWrap>
          <thead>
            <tr>
              <th>Πρώτη ύλη</th>
              <th>Μονάδα</th>
              <th className="text-right">Σύστημα</th>
              <th className="w-44">Μετρήθηκε</th>
              <th className="text-right">Διαφορά</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const v = valueOf(i);
              const parsed = v.trim() === "" ? i.stock : parseDecimal(v, i.stock);
              const delta = Math.round((parsed - i.stock) * 1000) / 1000;
              return (
                <tr key={i.id} className={delta !== 0 ? "bg-warn-soft/40" : ""}>
                  <td className="font-medium">{i.name}</td>
                  <td className="text-ink-2">{i.unitLabel}</td>
                  <td className="text-right num text-ink-2">{fmtQty(i.stock)}</td>
                  <td>
                    <input
                      className="input num py-1.5"
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => setCounted((c) => ({ ...c, [i.id]: e.target.value }))}
                      aria-label={`Μετρημένη ποσότητα ${i.name}`}
                    />
                  </td>
                  <td className={`text-right num font-semibold ${delta > 0 ? "text-ok" : delta < 0 ? "text-danger" : "text-ink-3"}`}>{delta !== 0 ? fmtQty(delta, true) : "—"}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="text-ink-3">
                  Δεν βρέθηκαν πρώτες ύλες.
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
        <div className="flex flex-wrap items-center gap-3 p-3 border-t border-line">
          <input className="input sm:max-w-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Σημείωση απογραφής (προαιρετικά)" aria-label="Σημείωση" />
          <span className="text-sm text-ink-3">
            {changed.length ? (
              <Badge tone="warn">{changed.length} αλλαγές</Badge>
            ) : (
              "Καμία αλλαγή"
            )}
          </span>
          <button className="btn-primary btn-sm ml-auto" disabled={pending || !changed.length} onClick={submit}>
            {pending ? "Καταχώρηση…" : "Καταχώρηση απογραφής"}
          </button>
        </div>
      </Section>
    </div>
  );
}
