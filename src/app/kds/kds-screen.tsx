"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ItemStatus, OrderType, StationKind } from "@/db/schema";
import { useToast } from "@/components/ui";
import { useNow } from "@/components/ops/use-now";
import { ORDER_TYPE_LABEL, courseLabel, fmtElapsed, fmtTime } from "@/components/ops/labels";
import { bumpOrderAction, setItemStatusAction } from "./actions";

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
  items: KdsItemDto[];
};
export type KdsStationDto = { id: number; name: string; kind: StationKind };

const WARN_MS = 10 * 60 * 1000;
const DANGER_MS = 20 * 60 * 1000;

function nextStatus(s: string): "preparing" | "ready" {
  return s === "preparing" ? "ready" : "preparing";
}

export function KdsScreen({ stations, stationId, tickets }: { stations: KdsStationDto[]; stationId: number | null; tickets: KdsTicketDto[] }) {
  const now = useNow();
  const { toast, element } = useToast();
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<number, ItemStatus>>({});
  const [bumping, setBumping] = useState<number | null>(null);

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
      setBumping(null);
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
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-black leading-tight truncate">{t.tableName}</div>
                    <div className="text-xs text-slate-300 truncate">
                      <span className="font-semibold tracking-wide">{ORDER_TYPE_LABEL[t.orderType]}</span> · {t.waiter} · Γύρος {t.roundNo}
                    </div>
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
                  className="m-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-lg py-3 touch active:scale-[0.98] disabled:opacity-50"
                >
                  {bumping === t.orderId ? "..." : "ΕΤΟΙΜΟ"}
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
