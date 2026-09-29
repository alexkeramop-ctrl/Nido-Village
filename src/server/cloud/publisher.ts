/**
 * Στέλνει περιοδικά τα στατιστικά στο cloud ώστε οι συνεταίροι να τα βλέπουν online.
 *  - NIDO_MODE=store (προεπιλογή): υπολογίζει snapshot κάθε CLOUD_SYNC_INTERVAL_SEC (60") και
 *    μετά από κάθε αλλαγή (με καθυστέρηση 10"), το αποθηκεύει τοπικά και, αν υπάρχει CLOUD_SYNC_URL,
 *    το κάνει POST στο /api/sync του cloud με το CLOUD_SYNC_KEY.
 *  - NIDO_MODE=cloud: δεν στέλνει τίποτα· δέχεται από το /api/sync.
 */
import { subscribe } from "@/server/events";
import { computeSnapshot, storeSnapshot } from "./snapshot";

type State = { timer?: NodeJS.Timeout; debounce?: NodeJS.Timeout; running: boolean; lastError: string | null; lastSentAt: Date | null; unsubscribe?: () => void };
const g = globalThis as unknown as { __nidoPublisher?: State };

export function publisherStatus() {
  const s = g.__nidoPublisher;
  return { enabled: !!s, lastError: s?.lastError ?? null, lastSentAt: s?.lastSentAt ?? null, url: process.env.CLOUD_SYNC_URL ?? null };
}

export async function publishOnce(): Promise<void> {
  const snap = await computeSnapshot();
  await storeSnapshot(snap);
  const url = process.env.CLOUD_SYNC_URL;
  const key = process.env.CLOUD_SYNC_KEY;
  if (!url || !key) return;
  const res = await fetch(url.replace(/\/$/, "") + "/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-nido-sync-key": key },
    body: JSON.stringify(snap),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Cloud sync ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function startCloudPublisher() {
  if (process.env.NIDO_MODE === "cloud") return;
  if (g.__nidoPublisher) return;
  const state: State = { running: false, lastError: null, lastSentAt: null };
  g.__nidoPublisher = state;
  const intervalMs = Math.max(20, Number(process.env.CLOUD_SYNC_INTERVAL_SEC ?? 60)) * 1000;
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await publishOnce();
      state.lastError = null;
      state.lastSentAt = new Date();
    } catch (e) {
      state.lastError = e instanceof Error ? e.message : String(e);
      console.warn("[cloud-sync]", state.lastError);
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(tick, intervalMs);
  state.timer.unref?.();
  state.unsubscribe = subscribe((e) => {
    if (e.type === "session.changed" || e.type === "stock.changed") {
      if (state.debounce) clearTimeout(state.debounce);
      state.debounce = setTimeout(tick, 10000);
      state.debounce.unref?.();
    }
  });
  setTimeout(tick, 5000).unref?.();
}
