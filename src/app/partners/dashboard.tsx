"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatEuro } from "@/server/money";
import type { Snapshot } from "@/server/cloud/snapshot";

const METHOD: Record<string, string> = { cash: "Μετρητά", card: "Κάρτα", other: "Άλλο" };
const DAY_NAMES = ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"];

function fmtDay(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-2xl bg-dark-2 border border-dark-3 p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-1 num ${tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function Bars({ data, labelOf }: { data: { key: string; value: number; label?: string }[]; labelOf?: (k: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[3px] h-40 w-full overflow-hidden">
      {data.map((d) => (
        <div key={d.key} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group" title={`${labelOf ? labelOf(d.key) : d.key}: ${formatEuro(d.value)}`}>
          <div className="w-full rounded-t bg-brand-light/80 group-hover:bg-brand-light transition-all" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-dark-2 border border-dark-3 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-100">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PartnersDashboard({
  snapshot: s,
  receivedAt,
  source,
  history,
}: {
  snapshot: Snapshot;
  receivedAt: string;
  source: "sync" | "live";
  history: { day: string; grossCents: number; sessions: number }[];
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 30000);
    const r = setInterval(() => router.refresh(), 60000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [router]);
  const ageMin = Math.max(0, Math.round((now - new Date(receivedAt).getTime()) / 60000));
  const stale = ageMin > 10;
  const diffVsYesterday = s.today.grossCents - s.yesterday.grossCents;
  const totalMethods = Object.values(s.today.byMethod).reduce((n, v) => n + v, 0);
  const hist = history.slice().reverse();

  return (
    <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className={`inline-block w-2 h-2 rounded-full ${stale ? "bg-amber-400" : "bg-emerald-400"}`} />
        {source === "live" ? "Ζωντανά δεδομένα" : `Ενημέρωση πριν ${ageMin} λεπτά`}
        {stale && <span className="text-amber-400">· το κατάστημα δεν έχει στείλει πρόσφατα (έλεγξε internet στο κατάστημα)</span>}
        <span className="ml-auto">Ημέρα: {s.today.range.from}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Τζίρος σήμερα" value={formatEuro(s.today.grossCents)} sub={`${s.today.sessions} λογαριασμοί · μέση ${formatEuro(s.today.avgTicketCents)}`} />
        <Tile
          label="Σε σχέση με χθες"
          value={`${diffVsYesterday >= 0 ? "+" : ""}${formatEuro(diffVsYesterday)}`}
          sub={`Χθες: ${formatEuro(s.yesterday.grossCents)}`}
          tone={diffVsYesterday >= 0 ? "ok" : "warn"}
        />
        <Tile label="Ανοιχτά τραπέζια τώρα" value={String(s.live.openSessions)} sub={`${formatEuro(s.live.openCents)} σε εξέλιξη · ${s.live.pendingKitchen} είδη στην κουζίνα`} />
        <Tile label="Μήνας μέχρι σήμερα" value={formatEuro(s.mtd.grossCents)} sub={`${s.mtd.sessions} λογαριασμοί · ${s.mtd.covers} άτομα`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Τελευταίες 30 ημέρες" right={<span className="text-sm text-slate-300 num">{formatEuro(s.last30.grossCents)}</span>}>
          <Bars data={s.last30.byDay.map((d) => ({ key: d.day, value: d.grossCents }))} labelOf={fmtDay} />
          <div className="flex justify-between text-[11px] text-slate-500 mt-1">
            <span>{s.last30.byDay[0] ? fmtDay(s.last30.byDay[0].day) : ""}</span>
            <span>{s.last30.byDay.at(-1) ? fmtDay(s.last30.byDay.at(-1)!.day) : ""}</span>
          </div>
        </Section>
        <Section title="Σήμερα ανά ώρα">
          {s.today.byHour.length ? (
            <>
              <Bars data={s.today.byHour.map((h) => ({ key: String(h.hour), value: h.grossCents }))} labelOf={(k) => `${k}:00`} />
              <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                <span>{s.today.byHour[0].hour}:00</span>
                <span>{s.today.byHour.at(-1)!.hour}:00</span>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500 h-40 flex items-center justify-center">Δεν υπάρχουν κλεισμένοι λογαριασμοί ακόμη</div>
          )}
        </Section>
        <Section title="Πληρωμές σήμερα">
          <div className="space-y-2">
            {Object.entries(s.today.byMethod).map(([m, v]) => (
              <div key={m}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">{METHOD[m] ?? m}</span>
                  <span className="num">{formatEuro(v)}</span>
                </div>
                <div className="h-1.5 rounded bg-dark-3 mt-1">
                  <div className="h-1.5 rounded bg-brand-light" style={{ width: `${totalMethods ? (v / totalMethods) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            {!Object.keys(s.today.byMethod).length && <div className="text-sm text-slate-500">Καμία πληρωμή ακόμη</div>}
            <div className="pt-2 border-t border-dark-3 text-xs text-slate-400 space-y-1">
              <div className="flex justify-between"><span>Εκπτώσεις</span><span className="num">{formatEuro(s.today.discountsCents)}</span></div>
              <div className="flex justify-between"><span>Ακυρώσεις</span><span className="num">{s.today.voidsCount} ({formatEuro(s.today.voidsCents)})</span></div>
              {s.today.vat.map((v) => (
                <div key={v.ratePct} className="flex justify-between"><span>ΦΠΑ {v.ratePct}%</span><span className="num">{formatEuro(v.vatCents)}</span></div>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Κορυφαία είδη (30 ημέρες)">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr><th className="text-left py-1">Είδος</th><th className="text-right">Τεμ.</th><th className="text-right">Τζίρος</th><th className="text-right hidden sm:table-cell">Περιθ.</th></tr>
            </thead>
            <tbody>
              {s.topProducts30.slice(0, 12).map((p) => (
                <tr key={p.productId} className="border-t border-dark-3">
                  <td className="py-1.5 text-slate-200">{p.name}<span className="text-slate-500 text-xs"> · {p.category}</span></td>
                  <td className="text-right num">{p.qty}</td>
                  <td className="text-right num">{formatEuro(p.grossCents)}</td>
                  <td className={`text-right num hidden sm:table-cell ${p.marginPct < 50 ? "text-amber-400" : "text-emerald-400"}`}>{p.costCents ? `${p.marginPct}%` : "–"}</td>
                </tr>
              ))}
              {!s.topProducts30.length && <tr><td colSpan={4} className="py-3 text-slate-500">Δεν υπάρχουν πωλήσεις</td></tr>}
            </tbody>
          </table>
        </Section>
        <div className="space-y-4">
          <Section title="Κατηγορίες (30 ημέρες)">
            {s.byCategory30.map((c) => (
              <div key={c.category} className="mb-2">
                <div className="flex justify-between text-sm"><span className="text-slate-300">{c.category}</span><span className="num">{formatEuro(c.grossCents)}</span></div>
                <div className="h-1.5 rounded bg-dark-3 mt-1"><div className="h-1.5 rounded bg-brand-light" style={{ width: `${s.last30.grossCents ? (c.grossCents / s.last30.grossCents) * 100 : 0}%` }} /></div>
              </div>
            ))}
            {!s.byCategory30.length && <div className="text-sm text-slate-500">Δεν υπάρχουν πωλήσεις</div>}
          </Section>
          <Section title="Προσωπικό (30 ημέρες)">
            <table className="w-full text-sm">
              <tbody>
                {s.byEmployee30.map((e) => (
                  <tr key={e.employeeId} className="border-t border-dark-3 first:border-0">
                    <td className="py-1.5 text-slate-200">{e.name}</td>
                    <td className="text-right text-slate-400 num">{e.sessions} τραπ.</td>
                    <td className="text-right num">{formatEuro(e.grossCents)}</td>
                  </tr>
                ))}
                {!s.byEmployee30.length && <tr><td className="py-2 text-slate-500">Δεν υπάρχουν πωλήσεις</td></tr>}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Αποθήκη" right={<span className="text-sm text-slate-300 num">Αξία {formatEuro(s.stock.valueCents)}</span>}>
          {s.stock.low.length ? (
            <ul className="text-sm space-y-1">
              {s.stock.low.map((i) => (
                <li key={i.name} className="flex justify-between"><span className="text-amber-300">{i.name}</span><span className="num text-slate-400">{i.stock} / ελάχ. {i.min} {i.unit}</span></li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-emerald-400">Κανένα είδος κάτω από το ελάχιστο απόθεμα</div>
          )}
        </Section>
        <Section title="Ιστορικό ημερών">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {hist.slice(0, 60).map((h) => (
                  <tr key={h.day} className="border-t border-dark-3 first:border-0">
                    <td className="py-1 text-slate-300">{fmtDay(h.day)} <span className="text-slate-500 text-xs">{h.day}</span></td>
                    <td className="text-right text-slate-400 num">{h.sessions}</td>
                    <td className="text-right num">{formatEuro(h.grossCents)}</td>
                  </tr>
                ))}
                {!hist.length && <tr><td className="py-2 text-slate-500">Το ιστορικό γεμίζει καθημερινά από το κατάστημα</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="text-xs text-slate-500 flex flex-wrap gap-3">
        <span>Εκτυπωτές: {s.printers.map((p) => `${p.name} ${p.ok ? "✓" : "✗"}`).join(" · ") || "–"}</span>
        <span className="ml-auto">Υπολογίστηκε {new Date(s.computedAt).toLocaleString("el-GR", { timeZone: "Europe/Athens", hourCycle: "h23" })}</span>
      </div>
    </div>
  );
}
