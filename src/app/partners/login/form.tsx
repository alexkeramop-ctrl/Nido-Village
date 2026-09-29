"use client";
import { useState, useTransition } from "react";
import { partnerLoginAction } from "../actions";

export function PartnerLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="card p-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await partnerLoginAction(email, password);
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      <label className="block">
        <span className="label">Email</span>
        <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="block">
        <span className="label">Κωδικός</span>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="text-danger text-sm">{error}</div>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "..." : "Είσοδος"}
      </button>
    </form>
  );
}
