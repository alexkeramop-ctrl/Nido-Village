"use client";
import { Mark } from "@/components/brand";
import { useNow } from "@/components/ops/use-now";
import { firstName } from "@/components/qr/labels";
import { usePublicLive } from "@/components/qr/live";
import type { listPickupBoard } from "@/server/services/public-order";

type Row = Awaited<ReturnType<typeof listPickupBoard>>[number];

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
}

export function BoardClient({ venueName, rows }: { venueName: string; rows: Row[] }) {
  usePublicLive({ board: true }, { pollMs: 15000 });
  const now = useNow();
  const preparing = rows.filter((r) => r.status === "received" || r.status === "preparing").sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const ready = rows.filter((r) => r.status === "ready").sort((a, b) => (a.readyAt ?? a.openedAt).localeCompare(b.readyAt ?? b.openedAt));

  return (
    <div className="flex-1 min-h-screen flex flex-col bg-dark text-white select-none">
      <header className="flex items-center justify-between px-6 py-4 border-b border-dark-3">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-cream px-3 py-1.5 flex items-center"><Mark height={34} /></span>
          <span className="text-2xl font-black tracking-tight text-brand-soft">{venueName}</span>
          <span className="text-lg text-slate-300 font-medium">Παραλαβές</span>
        </div>
        <div className="text-4xl font-bold num text-slate-100" suppressHydrationWarning>
          {now === null ? "--:--" : clock(now)}
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 md:p-6">
        <section aria-labelledby="col-preparing" data-column="preparing" className="rounded-3xl bg-dark-2 border border-dark-3 p-4 md:p-6 flex flex-col">
          <h2 id="col-preparing" className="text-2xl md:text-3xl font-black tracking-wide text-slate-200 text-center mb-4">
            ΕΤΟΙΜΑΖΟΝΤΑΙ
          </h2>
          {preparing.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xl text-center">Καμία παραγγελία σε εξέλιξη</div>
          ) : (
            <ul className="grid grid-cols-2 xl:grid-cols-3 gap-3 content-start">
              {preparing.map((r) => (
                <li key={r.sessionId} className="rounded-2xl bg-dark-3/70 border border-white/10 px-3 py-4 text-center">
                  <div className="text-5xl md:text-6xl font-black num leading-none text-slate-100">{r.code}</div>
                  <div className="text-lg md:text-xl text-slate-300 mt-2 truncate">{firstName(r.customerName) || "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="col-ready" data-column="ready" className="rounded-3xl bg-emerald-950/60 border-2 border-emerald-500 p-4 md:p-6 flex flex-col">
          <h2 id="col-ready" className="text-2xl md:text-3xl font-black tracking-wide text-emerald-300 text-center mb-4">
            ΕΤΟΙΜΕΣ ΓΙΑ ΠΑΡΑΛΑΒΗ
          </h2>
          {ready.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-emerald-200/50 text-xl text-center">Καμία έτοιμη παραγγελία</div>
          ) : (
            <ul className="grid grid-cols-2 xl:grid-cols-3 gap-3 content-start">
              {ready.map((r) => (
                <li key={r.sessionId} className="rounded-2xl bg-emerald-600 text-white px-3 py-4 text-center shadow-lg">
                  <div className="text-5xl md:text-6xl font-black num leading-none">{r.code}</div>
                  <div className="text-lg md:text-xl mt-2 truncate text-emerald-50">{firstName(r.customerName) || "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="px-6 py-2 text-center text-sm text-slate-500 border-t border-dark-3">Όταν δεις τον κωδικό σου στα «Έτοιμες», πέρασε από το ταμείο για παραλαβή και πληρωμή.</footer>
    </div>
  );
}
