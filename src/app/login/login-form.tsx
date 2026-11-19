"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Numpad } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    if (pin.length < 4) return;
    start(async () => {
      const r = await loginAction(pin, next);
      if (r && !r.ok) {
        setError(r.error);
        setPin("");
      }
    });
  };
  // Πληκτρολόγιο: ψηφία, Backspace/Delete για σβήσιμο, Escape για καθάρισμα, Enter για είσοδο.
  const live = useRef({ pin, pending, submit });
  useEffect(() => {
    live.current = { pin, pending, submit };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { pin: cur, pending: busy, submit: go } = live.current;
      if (busy) return;
      if (/^[0-9]$/.test(e.key)) {
        if (cur.length < 8) {
          setError(null);
          setPin(cur + e.key);
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        setPin(cur.slice(0, -1));
      } else if (e.key === "Escape") {
        setPin("");
      } else if (e.key === "Enter") {
        go();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="card p-5">
      <div className="h-12 flex items-center justify-center text-3xl tracking-[0.5em] num">{pin ? "•".repeat(pin.length) : <span className="text-ink-3 text-base tracking-normal">PIN</span>}</div>
      {error && <div className="text-danger text-sm text-center mb-2">{error}</div>}
      <Numpad value={pin} onChange={(v) => { setError(null); setPin(v); }} onSubmit={submit} mode="pin" submitLabel={pending ? "..." : "Είσοδος"} disabled={pending} />
    </div>
  );
}
