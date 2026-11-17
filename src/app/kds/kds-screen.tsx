"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ItemStatus, OrderType, SessionSource, StationKind } from "@/db/schema";
import { useToast } from "@/components/ui";
import { useNow } from "@/components/ops/use-now";
import { ORDER_TYPE_LABEL, courseLabel, fmtElapsed, fmtTime } from "@/components/ops/labels";
import { bumpOrderAction, markPickedUpAction, setItemStatusAction } from "./actions";

export type KdsItemDto = { id: number; qty: number; name: string; modifiers: string[]; notes: string | null; course: number; status: string };
export type KdsTicketDto = {
  orderId: number;
  sessionId: number;
  tableName: string;
  orderType: OrderType;
  waiter: string;
  roundNo: number;
  createdAt: string;
  notes: string | null;
  buzzerNo: number | null;
  customerName: string | null;
  source: SessionSource;
  paid: boolean;
  items: KdsItemDto[];
};
export type KdsReadyDto = { sessionId: number; buzzerNo: number | null; name: string; customerName: string; readyAt: string; paid: boolean };
export type KdsStationDto = { id: number; name: string; kind: StationKind };

const WARN_MS = 10 * 60 * 1000;
const DANGER_MS = 20 * 60 * 1000;

function nextStatus(s: string): "preparing" | "ready" {
  return s === "preparing" ? "ready" : "preparing";
}

export function KdsScreen({ stations, stationId, tickets, ready }: { stations: KdsStationDto[]; stationId: number | null; tickets: KdsTicketDto[]; ready: KdsReadyDto[] }) {
  const now = useNow();
  const { toast, element } = useToast();
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<number, ItemStatus>>({});
  const [bumping, setBumping] = useState<number | null>(null);
  const [handing, setHanding] = useState<number | null>(null);

  const tapItem = (item: KdsItemDto) => {
    const status = nextStatus(optimistic[item.id] ?? item.status);
    setOptimistic((o) => ({ ...o, [item.id]: status }));
    start(async () => {
      const r = await setItemStatusAction(item.id, status);
      if (!r.ok) toast(r.error, "danger");
      setOptimistic((o) => {
        const copy = { ...o };
        delete copy[item.id];
        return copy;
      });
    });
  };

  const bump = (t: KdsTicketDto) => {
    setBumping(t.orderId);
    start(async () => {
      const r = await bumpOrderAction(t.orderId, stationId);
      if (!r.ok) toast(r.error, "danger");
      // Το «ΕΤΟΙΜΟ» είναι το σήμα για τον βομβητή — αλλά μόνο όταν είναι έτοιμα τα είδη ΟΛΩΝ των σταθμών.
      else if (r.data?.allReady) toast(r.data.buzzerNo ? `🔔 Χτύπα τον βομβητή ${r.data.buzzerNo}` : `Έτοιμη η παραγγελία ${r.data.name}`);
      else if (r.data) toast(r.data.buzzerNo ? `Έτοιμο από εδώ · ο βομβητής ${r.data.buzzerNo} περιμένει και άλλο σταθμό` : "Έτοιμο από εδώ · περιμένει και άλλος σταθμός");
      setBumping(null);
    });
  };

  const handOver = (r: KdsReadyDto) => {
    setHanding(r.sessionId);
    start(async () => {
      const res = await markPickedUpAction(r.sessionId);
      if (!res.ok) toast(res.error, "danger");
      setHanding(null);
    });
  };

  return (
    <main className="flex-1 p-3 sm:p-4 space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 touch">
        <StationChip href="/kds?station=all" active={stationId === null} label="Όλα" />
        {stations.map((s) => (
          <StationChip key={s.id} href={`/kds?station=${s.id}`} active={stationId === s.id} label={s.name} />
        ))}
        <span className="ml-auto self-center text-sm text-slate-400 whitespace-nowrap num">
          {tickets.length} {tickets.length === 1 ? "παραγγελία" : "παραγγελίες"}
        </span>
      </div>

      {ready.length > 0 && (
        <section aria-labelledby="kds-ready" className="rounded-2xl border-2 border-emerald-500 bg-emerald-950/50 p-3">
          <h2 id="kds-ready" className="text-sm font-bold uppercase tracking-wide text-emerald-300 mb-2">
            Έτοιμες – προς παράδοση <span className="num">({ready.length})</span>
          </h2>
          <ul className="flex flex-wrap gap-2">
            {ready.map((r) => (
              <li key={r.sessionId} className="flex items-center gap-2 rounded-xl bg-emerald-700/70 pl-3 pr-1.5 py-1.5">
                <span className="leading-tight">
                  <span className="block text-xl font-black num">{r.buzzerNo ? `🔔 ${r.buzzerNo}` : r.name}</span>
                  <span className="block text-[11px] text-emerald-100 num">
                    {r.customerName && !r.name.includes(r.customerName) ? `${r.customerName} · ` : ""}
                    {fmtTime(r.readyAt)}
                    {!r.paid ? " · απλήρωτη" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={handing === r.sessionId}
                  onClick={() => handOver(r)}
                  aria-label={`Παραδόθηκε: ${r.buzzerNo ? `Βομβητής ${r.buzzerNo}` : r.name}`}
                  className="rounded-lg bg-white/15 hover:bg-white/25 px-3 py-2 text-sm font-semibold touch disabled:opacity-50"
                >
                  {handing === r.sessionId ? "…" : "Παραδόθηκε"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tickets.length === 0 ? (
        <div className="rounded-2xl border border-dark-3 bg-dark-2 p-10 text-center">
          <div className="text-xl font-semibold text-slate-200">Καμία εκκρεμής παραγγελία</div>
          <div className="text-sm text-slate-400 mt-1">Οι νέες παραγγελίες εμφανίζονται εδώ αυτόματα.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {tickets.map((t) => {
            const age = now === null ? null : now - new Date(t.createdAt).getTime();
            const tone =
              age !== null && age > DANGER_MS
                ? "border-danger bg-red-950/60"
                : age !== null && age > WARN_MS
                  ? "border-warn bg-amber-950/50"
                  : "border-dark-3 bg-dark-2";
            const timerTone = age !== null && age > DANGER_MS ? "text-red-300" : age !== null && age > WARN_MS ? "text-amber-300" : "text-slate-200";
            return (
              <article key={t.orderId} className={`rounded-2xl border-2 ${tone} flex flex-col overflow-hidden`}>
                <header className="px-3 py-2 border-b border-white/10 flex items-start gap-2">
                  {t.buzzerNo !== null && (
                    <div aria-label={`Βομβητής ${t.buzzerNo}`} className="shrink-0 rounded-xl bg-amber-400 text-black px-2.5 py-1.5 flex items-center gap-1 leading-none">
                      <span aria-hidden className="text-xl">
                        🔔
                      </span>
                      <span className="text-4xl font-black num">{t.buzzerNo}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-black leading-tight truncate">{t.tableName}</div>
                    {t.customerName && !t.tableName.includes(t.customerName) && <div className="text-sm font-semibold text-slate-100 truncate">{t.customerName}</div>}
                    <div className="text-xs text-slate-300 truncate">
                      <span className="font-semibold tracking-wide">{t.source === "till" ? "ΤΑΜΕΙΟ" : ORDER_TYPE_LABEL[t.orderType]}</span> · {t.waiter} · Γύρος {t.roundNo}
                    </div>
                    {t.source === "qr" && !t.paid && <div className="mt-0.5 inline-block rounded bg-red-500/30 text-red-100 text-[11px] font-bold px-1.5 py-0.5">ΔΕΝ ΕΧΕΙ ΠΛΗΡΩΘΕΙ ΑΚΟΜΗ</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-2xl font-bold num leading-tight ${timerTone}`} suppressHydrationWarning>
                      {age === null ? "--:--" : fmtElapsed(age)}
                    </div>
                    <div className="text-[11px] text-slate-400 num">{fmtTime(t.createdAt)}</div>
                  </div>
                </header>
                {t.notes && <div className="px-3 py-1.5 bg-amber-400/20 text-amber-200 text-sm font-medium">Σημ.: {t.notes}</div>}
                <ul className="flex-1 divide-y divide-white/10">
                  {t.items.map((it) => {
                    const status = optimistic[it.id] ?? it.status;
                    const preparing = status === "preparing";
                    const ready = status === "ready";
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => tapItem(it)}
                          className={`w-full text-left px-3 py-2.5 touch transition active:bg-white/10 ${preparing ? "bg-brand-light/25" : ""} ${ready ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`text-xl font-black num shrink-0 ${ready ? "line-through" : ""}`}>{it.qty}×</span>
                            <div className="min-w-0 flex-1">
                              <div className={`text-lg font-semibold leading-snug ${ready ? "line-through" : ""}`}>{it.name}</div>
                              {it.modifiers.length > 0 && (
                                <ul className="pl-3 text-sm text-slate-300 leading-snug">
                                  {it.modifiers.map((m, i) => (
                                    <li key={i}>• {m}</li>
                                  ))}
                                </ul>
                              )}
                              {it.notes && <div className="mt-0.5 inline-block rounded px-1.5 py-0.5 bg-amber-400/25 text-amber-100 text-sm font-medium">{it.notes}</div>}
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              {new Set(t.items.map((x) => x.course)).size > 1 && (
                                <span className="rounded-full bg-white/10 text-[11px] px-2 py-0.5 text-slate-200 num">{courseLabel(it.course)}</span>
                              )}
                              {preparing && <span className="text-[11px] font-semibold text-emerald-300">ΕΤΟΙΜΑΖΕΤΑΙ</span>}
                              {ready && <span className="text-[11px] font-semibold text-emerald-300">✓ ΕΤΟΙΜΟ</span>}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  disabled={bumping === t.orderId}
                  onClick={() => bump(t)}
                  aria-label={t.buzzerNo !== null ? `Έτοιμο, βομβητής ${t.buzzerNo}` : `Έτοιμο, ${t.tableName}`}
                  className="m-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-lg py-3 touch active:scale-[0.98] disabled:opacity-50"
                >
                  {bumping === t.orderId ? "..." : t.buzzerNo !== null ? `ΕΤΟΙΜΟ · 🔔 ${t.buzzerNo}` : "ΕΤΟΙΜΟ"}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {element}
    </main>
  );
}

function StationChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold border transition touch ${
        active ? "bg-white text-dark border-white" : "bg-dark-2 text-slate-200 border-dark-3 hover:bg-dark-3"
      }`}
    >
      {label}
    </Link>
  );
}
