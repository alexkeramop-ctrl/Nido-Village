/**
 * Event bus εντός διεργασίας + Server-Sent Events.
 * Ο server τρέχει σε ένα box στο κατάστημα, οπότε ένας EventEmitter αρκεί.
 * Κρατιέται στο globalThis για να επιβιώνει του HMR στο dev.
 */
import { EventEmitter } from "node:events";
import { isWorker, runAfterResponse } from "@/server/cf";

export type NidoEvent =
  | { type: "floor.changed" }
  | { type: "session.changed"; sessionId: number }
  | { type: "kds.changed"; stationId?: number }
  | { type: "print.changed" }
  | { type: "catalog.changed" }
  | { type: "stock.changed" }
  | { type: "printer.status"; stationId: number; ok: boolean };

const g = globalThis as unknown as { __nidoBus?: EventEmitter };
export const bus: EventEmitter = (g.__nidoBus ??= new EventEmitter());
bus.setMaxListeners(200);

export function emit(event: NidoEvent) {
  bus.emit("event", event);
  // Cloudflare Workers: δεν υπάρχει worker εκτύπωσης στο παρασκήνιο· η ουρά αδειάζει μετά την απάντηση.
  if (event.type === "print.changed" && isWorker) {
    runAfterResponse(async () => {
      const { drainQueue } = await import("@/server/printing/queue");
      await drainQueue();
    });
  }
}

export function subscribe(fn: (e: NidoEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
