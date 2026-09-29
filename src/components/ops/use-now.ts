"use client";
import { useSyncExternalStore } from "react";

/**
 * Ρολόι που «χτυπά» κάθε δευτερόλεπτο, κοινό για όλα τα components της σελίδας.
 * Στον server επιστρέφει null ώστε να μην υπάρχει hydration mismatch.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let nowMs = 0;

function tick() {
  nowMs = Date.now();
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    nowMs = Date.now();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (!nowMs) nowMs = Date.now();
  return nowMs;
}

function getServerSnapshot(): number | null {
  return null;
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
