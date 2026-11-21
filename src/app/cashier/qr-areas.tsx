"use client";
import { Badge } from "@/components/ui";

export type QrArea = { id: number; name: string };
/** Τι δέχεται από QR ένα άλλο ανοιχτό ταμείο (null στους χώρους = όλοι, παλιές βάρδιες). */
export type QrOther = { registerName: string; qrAreaIds: number[] | null; qrTakeaway: boolean };
export type QrChoice = { areaIds: number[]; takeaway: boolean };

/** Σύντομη περιγραφή για τη γραμμή του ταμείου, π.χ. «Παιδική χαρά · Πακέτο». */
export function qrSummary(areas: QrArea[], qrAreaIds: number[] | null, takeaway: boolean): string {
  const names = qrAreaIds === null ? ["Όλοι οι χώροι"] : areas.filter((a) => qrAreaIds.includes(a.id)).map((a) => a.name);
  if (takeaway) names.push("Πακέτο");
  return names.length ? names.join(" · ") : "Κανένα";
}

function claimedBy(others: QrOther[], areaId: number | null): string[] {
  return others.filter((o) => (areaId === null ? o.qrTakeaway : o.qrAreaIds === null || o.qrAreaIds.includes(areaId))).map((o) => o.registerName);
}

/**
 * Επιλογή «από ποιους χώρους δέχεται παραγγελίες QR αυτό το ταμείο». Δείχνει τι έχουν ήδη αναλάβει τα άλλα ανοιχτά ταμεία
 * και προειδοποιεί για χώρους που δεν τους έχει αναλάβει κανείς (τότε φαίνονται σε όλα τα ταμεία ως «Χωρίς ταμείο»).
 */
export function QrAreasPicker({
  areas,
  value,
  onChange,
  others,
  disabled = false,
}: {
  areas: QrArea[];
  value: QrChoice;
  onChange: (v: QrChoice) => void;
  others: QrOther[];
  disabled?: boolean;
}) {
  const toggleArea = (id: number) =>
    onChange({ ...value, areaIds: value.areaIds.includes(id) ? value.areaIds.filter((x) => x !== id) : [...value.areaIds, id].sort((a, b) => a - b) });
  const rows: { key: string; label: string; hint: string; on: boolean; toggle: () => void; claimed: string[] }[] = [
    ...areas.map((a) => ({
      key: `a${a.id}`,
      label: a.name,
      hint: "QR στα τραπέζια του χώρου",
      on: value.areaIds.includes(a.id),
      toggle: () => toggleArea(a.id),
      claimed: claimedBy(others, a.id),
    })),
    {
      key: "takeaway",
      label: "Πακέτο",
      hint: "QR χωρίς τραπέζι (είσοδος, αφίσα)",
      on: value.takeaway,
      toggle: () => onChange({ ...value, takeaway: !value.takeaway }),
      claimed: claimedBy(others, null),
    },
  ];
  const orphan = rows.filter((r) => !r.on && r.claimed.length === 0).map((r) => r.label);
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold mb-1">Παραγγελίες QR που εμφανίζονται εδώ</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            role="checkbox"
            aria-checked={r.on}
            data-testid={`qr-${r.key}`}
            onClick={r.toggle}
            className={`touch rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${r.on ? "bg-brand-soft border-brand/50" : "bg-white/70 border-line"}`}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className={`grid place-items-center h-5 w-5 rounded-md border text-xs font-black ${r.on ? "bg-brand text-white border-brand" : "border-line bg-white"}`}>
                {r.on ? "✓" : ""}
              </span>
              <span className="font-semibold">{r.label}</span>
            </span>
            <span className="block text-xs text-ink-3 mt-0.5">{r.hint}</span>
            {r.claimed.length > 0 && (
              <span className="block mt-1">
                <Badge tone="neutral">Το έχει και: {r.claimed.join(", ")}</Badge>
              </span>
            )}
          </button>
        ))}
      </div>
      {orphan.length > 0 ? (
        <p className="rounded-xl bg-warn-soft text-warn px-3 py-2 text-xs font-medium">
          Κανένα ανοιχτό ταμείο δεν δέχεται: {orphan.join(", ")}. Αν έρθει τέτοια παραγγελία θα φανεί σε όλα τα ταμεία ως «Χωρίς ταμείο».
        </p>
      ) : (
        <p className="text-xs text-ink-3">Οι παραγγελίες τυπώνονται αμέσως στο μπαρ του χώρου και στην κουζίνα· εδώ εμφανίζονται για πληρωμή.</p>
      )}
    </fieldset>
  );
}
