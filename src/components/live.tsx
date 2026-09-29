"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

export type LiveEvent = { type: string; [k: string]: unknown };

/**
 * Ακούει τα SSE events του server και καλεί τον handler.
 * Αν δεν δοθεί handler, κάνει router.refresh() ώστε τα server components να ξαναφορτώσουν δεδομένα.
 */
export function useLive(types: string[] | "all", onEvent?: (e: LiveEvent) => void, opts: { pollMs?: number } = {}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  });
  const typesKey = types === "all" ? "all" : types.join(",");

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const wanted = typesKey === "all" ? null : new Set(typesKey.split(","));

    const fire = (e: LiveEvent) => {
      if (handlerRef.current) handlerRef.current(e);
      else {
        // Ομαδοποίηση: πολλά events σε 150ms -> ένα refresh.
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => startTransition(() => router.refresh()), 150);
      }
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as LiveEvent;
          if (e.type === "hello") return;
          if (!wanted || wanted.has(e.type)) fire(e);
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
    const poll = opts.pollMs ? setInterval(() => fire({ type: "poll" }), opts.pollMs) : null;
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (pending) clearTimeout(pending);
      if (poll) clearInterval(poll);
    };
  }, [typesKey, router, opts.pollMs]);
}

/** Drop-in για server pages: ανανεώνει τη σελίδα στα events που δίνονται. */
export function LiveRefresh({ types, pollMs }: { types: string[] | "all"; pollMs?: number }) {
  useLive(types, undefined, { pollMs });
  return null;
}
