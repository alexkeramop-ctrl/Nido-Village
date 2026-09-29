"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Money } from "@/components/ui";
import { fmtTime } from "@/components/ops/labels";
import { firstName } from "@/components/qr/labels";
import { usePublicLive } from "@/components/qr/live";
import type { PublicOrder, PublicOrderStatus } from "@/server/services/public-order";

const STEPS: { key: PublicOrderStatus; label: string; hint: string }[] = [
  { key: "received", label: "Ελήφθη", hint: "Η κουζίνα πήρε την παραγγελία σου." },
  { key: "preparing", label: "Ετοιμάζεται", hint: "Την ετοιμάζουμε αυτή τη στιγμή." },
  { key: "ready", label: "Έτοιμη για παραλαβή", hint: "Πέρασε από το ταμείο." },
  { key: "picked_up", label: "Παραλήφθηκε", hint: "Καλή όρεξη!" },
];

function stepIndex(status: PublicOrderStatus): number {
  if (status === "cancelled") return -1;
  if (status === "picked_up" || status === "done") return 3;
  return STEPS.findIndex((s) => s.key === status);
}

type AudioCtor = typeof AudioContext;

function getAudioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Σύντομο διπλό «ντιν» με WebAudio. Παίζει μόνο αν το AudioContext έχει ξεκλειδωθεί από χειρονομία του χρήστη. */
function beep(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const t = t0 + i * 0.22;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  });
}

export function StatusClient({ order, token, venueName }: { order: PublicOrder; token: string; venueName: string }) {
  usePublicLive({ token }, { pollMs: 10000 });
  const [armed, setArmed] = useState(false);
  const [notif, setNotif] = useState<NotificationPermission | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const notifiedRef = useRef(false);

  // Όταν η παραγγελία γίνει έτοιμη: δόνηση, ήχος (αν ξεκλειδώθηκε) και Notification (αν επιτράπηκε).
  useEffect(() => {
    if (order.status !== "ready") {
      notifiedRef.current = false;
      return;
    }
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* unsupported */
    }
    if (audioRef.current) {
      try {
        beep(audioRef.current);
      } catch {
        /* ignore */
      }
    }
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`${venueName}: η παραγγελία #${order.code} είναι έτοιμη`, {
          body: "Πέρασε από το ταμείο για παραλαβή και πληρωμή.",
          tag: `nido-order-${order.code}`,
        });
      } catch {
        /* ignore */
      }
    }
  }, [order.status, order.code, venueName]);

  const arm = async () => {
    // Ξεκλείδωμα ήχου: το AudioContext επιτρέπεται μόνο μετά από χειρονομία του χρήστη.
    try {
      const Ctor = getAudioCtor();
      if (Ctor) {
        const ctx = audioRef.current ?? new Ctor();
        audioRef.current = ctx;
        await ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      }
    } catch {
      /* ignore */
    }
    if ("Notification" in window) {
      try {
        const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        setNotif(p);
      } catch {
        /* ignore */
      }
    }
    setArmed(true);
  };

  const idx = stepIndex(order.status);
  const active = order.status === "received" || order.status === "preparing";
  const finished = order.status === "picked_up" || order.status === "done";
  const name = firstName(order.customerName);

  return (
    <div className="flex-1 flex flex-col max-w-lg w-full mx-auto min-h-full">
      <header className="bg-brand text-white px-4 pt-4 pb-3">
        <div className="text-xs uppercase tracking-widest text-white/80 font-semibold">{venueName}</div>
        <h1 className="text-xl font-bold leading-tight mt-0.5">Η παραγγελία σου</h1>
      </header>

      <main className="flex-1 px-3 py-4 space-y-4 pb-10">
        <section className="card p-5 text-center">
          <div className="text-xs uppercase tracking-widest text-ink-3 font-semibold">Κωδικός παραλαβής</div>
          <div className="text-7xl font-black num leading-none mt-1 text-ink" data-testid="pickup-code">
            #{order.code}
          </div>
          {name && <div className="text-xl font-semibold mt-2">{name}</div>}
          <div className="text-xs text-ink-3 mt-1 num">Παραγγελία {fmtTime(order.createdAt)}</div>
        </section>

        {order.status === "ready" && (
          <section className="rounded-2xl bg-ok text-white p-5 text-center shadow-lg" role="status" aria-live="assertive">
            <div className="text-4xl" aria-hidden>
              ✅
            </div>
            <div className="text-2xl font-black leading-tight mt-1">Η παραγγελία σου είναι έτοιμη!</div>
            <div className="text-base mt-2 text-white/95">Πέρασε από το ταμείο για παραλαβή και πληρωμή.</div>
            {order.readyAt && <div className="text-xs text-white/80 mt-2 num">Έτοιμη από {fmtTime(order.readyAt)}</div>}
          </section>
        )}

        {finished && (
          <section className="rounded-2xl bg-brand-soft text-brand-2 p-5 text-center">
            <div className="text-4xl" aria-hidden>
              🙏
            </div>
            <div className="text-xl font-bold mt-1">Ευχαριστούμε!</div>
            <div className="text-sm mt-1">Η παραγγελία παραδόθηκε. Καλή όρεξη!</div>
          </section>
        )}

        {order.status === "cancelled" && (
          <section className="rounded-2xl bg-danger-soft text-danger p-5 text-center">
            <div className="text-xl font-bold">Η παραγγελία ακυρώθηκε</div>
            <div className="text-sm mt-1">Αν έχεις απορία, ρώτησε στο ταμείο.</div>
          </section>
        )}

        {order.status !== "cancelled" && (
          <section className="card p-4">
            <ol className="space-y-0">
              {STEPS.map((s, i) => {
                const done = i < idx;
                const current = i === idx;
                return (
                  <li key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          done ? "bg-brand text-white" : current ? "bg-ok text-white ring-4 ring-ok-soft" : "bg-surface-3 text-ink-3"
                        }`}
                        aria-hidden
                      >
                        {done ? "✓" : i + 1}
                      </span>
                      {i < STEPS.length - 1 && <span className={`w-0.5 flex-1 min-h-5 ${done ? "bg-brand" : "bg-line"}`} aria-hidden />}
                    </div>
                    <div className={`pb-4 ${current ? "" : "opacity-70"}`}>
                      <div className={`font-semibold leading-8 ${current ? "text-ok" : done ? "text-ink" : "text-ink-3"}`} aria-current={current ? "step" : undefined}>
                        {s.label}
                      </div>
                      {current && <div className="text-xs text-ink-3 -mt-1">{s.hint}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {active && (
          <section className="card p-4 space-y-2">
            {armed ? (
              <div className="text-sm text-ok font-medium">
                ✓ Θα ακούσεις ήχο όταν η παραγγελία είναι έτοιμη.
                {notif === "granted" && " Θα λάβεις και ειδοποίηση."}
              </div>
            ) : (
              <button type="button" className="btn-secondary w-full" onClick={arm}>
                🔔 Ειδοποίησέ με όταν είναι έτοιμη
              </button>
            )}
            <p className="text-xs text-ink-3 text-center">Κράτα αυτή τη σελίδα ανοιχτή για να ειδοποιηθείς.</p>
          </section>
        )}

        <section className="card p-4">
          <h2 className="font-semibold mb-2">Είδη</h2>
          <ul className="divide-y divide-line">
            {order.items.map((it, i) => (
              <li key={i} className="py-2 flex gap-2 items-start">
                <span className="num font-bold w-8 shrink-0">{it.qty}×</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-snug">{it.name}</div>
                  {it.modifiers.length > 0 && <div className="text-xs text-ink-2">{it.modifiers.join(", ")}</div>}
                  {it.notes && <div className="text-xs italic text-warn">{it.notes}</div>}
                </div>
                <Money cents={it.lineTotalCents} className="text-sm shrink-0" />
              </li>
            ))}
          </ul>
          <div className="border-t border-line mt-2 pt-2 flex items-center justify-between">
            <span className="font-semibold">Σύνολο</span>
            <Money cents={order.totalCents} className="font-bold text-xl" />
          </div>
          <div className={`mt-2 text-sm font-medium ${order.paid ? "text-ok" : "text-ink-2"}`}>{order.paid ? "✓ Πληρώθηκε" : "Πληρωμή στο ταμείο"}</div>
        </section>

        <div className="text-center">
          <Link href="/order" className="text-sm text-brand-2 font-medium underline underline-offset-2">
            Νέα παραγγελία
          </Link>
        </div>
      </main>
    </div>
  );
}
