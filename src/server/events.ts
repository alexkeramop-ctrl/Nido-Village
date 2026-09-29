/**
 * Event bus εντός διεργασίας + Server-Sent Events.
 * Ο server τρέχει σε ένα box στο κατάστημα, οπότε ένας EventEmitter αρκεί.
 * Κρατιέται στο globalThis για να επιβιώνει του HMR στο dev.
 */
import { EventEmitter } from "node:events";

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
}

export function subscribe(fn: (e: NidoEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
