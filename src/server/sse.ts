/** Απάντηση SSE «δεν υποστηρίζεται εδώ»: ο client κλείνει τη σύνδεση και ανανεώνει με polling. */
export const SSE_FALLBACK_POLL_MS = 10000;

export function sseUnsupported() {
  return new Response(`retry: 600000\ndata: ${JSON.stringify({ type: "unsupported", pollMs: SSE_FALLBACK_POLL_MS })}\n\n`, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
