"use client";
import { useState, useTransition } from "react";
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
  return (
    <div className="card p-5">
      <div className="h-12 flex items-center justify-center text-3xl tracking-[0.5em] num">{pin ? "•".repeat(pin.length) : <span className="text-ink-3 text-base tracking-normal">PIN</span>}</div>
      {error && <div className="text-danger text-sm text-center mb-2">{error}</div>}
      <Numpad value={pin} onChange={(v) => { setError(null); setPin(v); }} onSubmit={submit} mode="pin" submitLabel={pending ? "..." : "Είσοδος"} disabled={pending} />
    </div>
  );
}
