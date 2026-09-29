"use client";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { Section, TableWrap } from "@/components/admin/common";
import { euroToInput, fmtDateTime, fmtQty } from "@/components/admin/format";
import type { Ingredient } from "./types";

type Movement = {
  id: number;
  ingredientName: string;
  unitLabel: string;
  kind: string;
  kindLabel: string;
  qtyDelta: number;
  unitCost: number | null;
  refType: string | null;
  refId: number | null;
  note: string | null;
  createdAt: string;
};

const KIND_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "brand"> = {
  purchase: "ok",
  sale: "brand",
  void_reversal: "neutral",
  waste: "danger",
  count: "warn",
  manual: "neutral",
};
const REF_LABEL: Record<string, string> = { goods_receipt: "Παραλαβή", order_item: "Είδος παραγγελίας", order: "Παραγγελία", table_session: "Λογαριασμός" };

export function MovementsTab({ ingredients, selectedIngredientId, movements }: { ingredients: Ingredient[]; selectedIngredientId: number | null; movements: Movement[] }) {
  const router = useRouter();
  return (
    <Section
      title="Κινήσεις αποθέματος"
      actions={
        <select
          className="input"
          value={selectedIngredientId ?? ""}
          onChange={(e) => router.push(e.target.value ? `/admin/inventory?tab=movements&ingredient=${e.target.value}` : "/admin/inventory?tab=movements")}
          aria-label="Φίλτρο πρώτης ύλης"
        >
          <option value="">Όλες οι πρώτες ύλες</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      }
      flush
    >
      {movements.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th>Ώρα</th>
              <th>Πρώτη ύλη</th>
              <th>Είδος</th>
              <th className="text-right">Ποσότητα</th>
              <th className="text-right">Κόστος/μον.</th>
              <th>Αναφορά</th>
              <th>Σημείωση</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="num text-ink-3 whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                <td className="font-medium">{m.ingredientName}</td>
                <td>
                  <Badge tone={KIND_TONE[m.kind] ?? "neutral"}>{m.kindLabel}</Badge>
                </td>
                <td className={`text-right num font-semibold ${m.qtyDelta > 0 ? "text-ok" : m.qtyDelta < 0 ? "text-danger" : "text-ink-3"}`}>
                  {fmtQty(m.qtyDelta, true)} {m.unitLabel}
                </td>
                <td className="text-right num text-ink-2">{m.unitCost !== null ? `${euroToInput(m.unitCost)} €` : "—"}</td>
                <td className="text-ink-2 text-xs">{m.refType ? `${REF_LABEL[m.refType] ?? m.refType} #${m.refId ?? ""}` : "—"}</td>
                <td className="text-ink-2 text-xs max-w-64 truncate" title={m.note ?? undefined}>
                  {m.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν κινήσεις.</div>
      )}
    </Section>
  );
}
