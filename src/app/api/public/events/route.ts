import { subscribe, type NidoEvent } from "@/server/events";
import { getSessionIdForToken } from "@/server/services/public-order";

export const dynamic = "force-dynamic";

/** Δημόσιο SSE για τη σελίδα κατάστασης παραγγελίας QR: στέλνει μόνο αλλαγές της δικής της συνεδρίας. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const board = url.searchParams.get("board") === "1";
  const sessionId = board ? null : await getSessionIdForToken(token);
  if (!board && !sessionId) return new Response("not found", { status: 404 });
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      send({ type: "hello" });
      unsubscribe = subscribe((e: NidoEvent) => {
        if (board) {
          if (e.type === "session.changed" || e.type === "kds.changed" || e.type === "floor.changed") send({ type: "changed" });
        } else if (e.type === "session.changed" && e.sessionId === sessionId) send({ type: "changed" });
      });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 15000);
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
