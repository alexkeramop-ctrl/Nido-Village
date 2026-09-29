import { formatEuro } from "@/server/money";

export type BarDatum = { key: string; label: string; value: number; sub?: string };

/**
 * Απλό ραβδόγραμμα μίας σειράς χωρίς βιβλιοθήκες (CSS). Οι τιμές είναι λεπτά.
 * Λεπτές ράβδοι, στρογγυλεμένη κορυφή, ετικέτες αραιωμένες ώστε να μην συγκρούονται.
 */
export function BarChart({ data, height = 168, emptyText = "Δεν υπάρχουν δεδομένα" }: { data: BarDatum[]; height?: number; emptyText?: string }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height }}>
        {emptyText}
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const maxIndex = data.findIndex((d) => d.value === max);
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div>
      <div className="flex items-end gap-[3px] border-b border-line" style={{ height }}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          return (
            <div
              key={d.key}
              className="group relative flex h-full flex-1 min-w-0 flex-col items-center justify-end"
              title={`${d.label}: ${formatEuro(d.value)}${d.sub ? ` · ${d.sub}` : ""}`}
            >
              {i === maxIndex && d.value > 0 && (
                <span className="mb-1 text-[10px] font-semibold text-ink-2 num whitespace-nowrap">{formatEuro(d.value)}</span>
              )}
              <div
                className="w-full max-w-7 rounded-t bg-brand/80 transition-colors group-hover:bg-brand"
                style={{ height: `${d.value > 0 ? Math.max(2, pct) : 0}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1">
        {data.map((d, i) => (
          <div key={d.key} className="flex-1 min-w-0 text-center text-[10px] text-ink-3 truncate">
            {i % labelEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
