"use client";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { InfoBox, Section, TableWrap, Toggle, useActionRunner } from "@/components/admin/common";
import { fmtPacks, fmtQty, parseDecimal, pluralGr } from "@/components/admin/format";
import { stockCountAction } from "./actions";
import type { Ingredient } from "./types";

type CountResult = { ingredientId: number; before: number; after: number; delta: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function CountTab({ ingredients }: { ingredients: Ingredient[] }) {
  const { run, pending, toastElement } = useActionRunner();
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [results, setResults] = useState<CountResult[] | null>(null);
  const [search, setSearch] = useState("");
  const [inPacks, setInPacks] = useState(false);

  const hasPacks = ingredients.some((i) => i.packSize);
  /** Η γραμμή μετριέται σε συσκευασίες όταν είναι ενεργή η επιλογή και η πρώτη ύλη έχει συσκευασία. */
  const packOf = (i: Ingredient) => (inPacks && i.packSize ? i.packSize : null);
  /** Προεπιλεγμένη τιμή του πεδίου: το απόθεμα του συστήματος, σε μονάδες ή συσκευασίες. */
  const valueOf = (i: Ingredient) => {
    const pack = packOf(i);
    return counted[i.id] ?? fmtQty(pack ? i.stock / pack : i.stock);
  };
  /** Μετρημένη ποσότητα σε μονάδες (μετατροπή από συσκευασίες × μέγεθος συσκευασίας). */
  const countedUnits = (i: Ingredient) => {
    const v = counted[i.id];
    if (v === undefined || v.trim() === "") return i.stock;
    const n = parseDecimal(v, Number.NaN);
    if (!Number.isFinite(n)) return i.stock;
    const pack = packOf(i);
    return round3(pack ? n * pack : n);
  };

  const changed = ingredients.filter((i) => counted[i.id] !== undefined && counted[i.id].trim() !== "" && countedUnits(i) !== i.stock);
  const q = search.trim().toLowerCase();
  const rows = q ? ingredients.filter((i) => i.name.toLowerCase().includes(q)) : ingredients;
  const nameOf = (id: number) => ingredients.find((i) => i.id === id);

  /** Αλλαγή τρόπου μέτρησης: οι ήδη συμπληρωμένες τιμές μετατρέπονται ώστε να μη χαθούν. */
  const togglePacks = (on: boolean) => {
    setCounted((c) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(c)) {
        const i = ingredients.find((x) => x.id === Number(k));
        const n = parseDecimal(v, Number.NaN);
        if (!i || !i.packSize || v.trim() === "" || !Number.isFinite(n)) {
          next[Number(k)] = v;
          continue;
        }
        next[Number(k)] = fmtQty(on ? n / i.packSize : n * i.packSize);
      }
      return next;
    });
    setInPacks(on);
  };

  const submit = () => {
    const lines = changed.map((i) => ({ ingredientId: i.id, countedQty: countedUnits(i) }));
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
        {hasPacks && " Με την «Καταμέτρηση σε συσκευασίες» μετράς μπουκάλια/κιβώτια (π.χ. 2,5) και το σύστημα τα μετατρέπει σε μονάδες."}
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
                    <td className="text-right num">
                      {fmtQty(r.after)}
                      {ing?.packSize && <span className="text-xs text-ink-3"> ({fmtPacks(r.after / ing.packSize, ing.packName ?? "συσκευασία")})</span>}
                    </td>
                    <td className={`text-right num font-semibold ${r.delta > 0 ? "text-ok" : r.delta < 0 ? "text-danger" : "text-ink-3"}`}>
                      {fmtQty(r.delta, true)} {ing?.unitLabel ?? ""}
                      {ing?.portionQty && <span className="block text-xs font-normal">{fmtQty(Math.round((r.delta / ing.portionQty) * 10) / 10, true)} {pluralGr(ing.portionName ?? "μερίδα", 2)}</span>}
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
            {hasPacks && <Toggle checked={inPacks} onChange={togglePacks} label="Καταμέτρηση σε συσκευασίες" />}
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
              const pack = packOf(i);
              const units = countedUnits(i);
              const delta = round3(units - i.stock);
              const measureLabel = pack ? pluralGr(i.packName ?? "συσκευασία", 2) : i.unitLabel;
              return (
                <tr key={i.id} className={delta !== 0 ? "bg-warn-soft/40" : ""}>
                  <td className="font-medium">{i.name}</td>
                  <td className="text-ink-2">
                    {i.unitLabel}
                    {i.packSize && (
                      <div className="text-xs text-ink-3 num whitespace-nowrap">
                        {i.packName ?? "συσκευασία"} = {fmtQty(i.packSize)} {i.unitLabel}
                      </div>
                    )}
                  </td>
                  <td className="text-right num text-ink-2">
                    {fmtQty(i.stock)}
                    {pack && <div className="text-xs text-ink-3 whitespace-nowrap">{fmtPacks(i.stock / pack, i.packName ?? "συσκευασία")}</div>}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <input
                        className="input num py-1.5"
                        inputMode="decimal"
                        value={v}
                        onChange={(e) => setCounted((c) => ({ ...c, [i.id]: e.target.value }))}
                        aria-label={`Μετρημένη ποσότητα ${i.name} (${measureLabel})`}
                      />
                      <span className="text-xs text-ink-3 whitespace-nowrap">{measureLabel}</span>
                    </div>
                    {pack && (
                      <div className="text-xs text-ink-3 num mt-1 whitespace-nowrap">
                        = {fmtQty(units)} {i.unitLabel}
                      </div>
                    )}
                  </td>
                  <td className={`text-right num font-semibold ${delta > 0 ? "text-ok" : delta < 0 ? "text-danger" : "text-ink-3"}`}>
                    {delta !== 0 ? fmtQty(delta, true) : "—"}
                    {delta !== 0 && i.portionQty && (
                      <div className="text-xs font-normal whitespace-nowrap">
                        {fmtQty(Math.round((delta / i.portionQty) * 10) / 10, true)} {pluralGr(i.portionName ?? "μερίδα", 2)}
                      </div>
                    )}
                  </td>
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
