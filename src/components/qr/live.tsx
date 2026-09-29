"use client";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * Ζωντανή ανανέωση για τις δημόσιες σελίδες (κατάσταση παραγγελίας, πίνακας παραλαβών).
 * Ακούει το δημόσιο SSE (/api/public/events) και κάνει router.refresh() σε κάθε αλλαγή.
 * Επιπλέον: polling ως εφεδρεία, επανασύνδεση σε σφάλμα, ανανέωση όταν η καρτέλα ξαναγίνει ορατή.
 */
export function usePublicLive(query: { token?: string; board?: boolean }, opts: { pollMs?: number } = {}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const url = query.board ? "/api/public/events?board=1" : `/api/public/events?token=${encodeURIComponent(query.token ?? "")}`;
  const pollMs = opts.pollMs ?? 0;

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      // Ομαδοποίηση: πολλά events σε 150ms -> ένα refresh.
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => startTransition(() => router.refresh()), 150);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource(url);
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as { type?: string };
          if (e.type === "changed") refresh();
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();

    const poll = pollMs > 0 ? setInterval(refresh, pollMs) : null;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (pending) clearTimeout(pending);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, pollMs, router]);
}
