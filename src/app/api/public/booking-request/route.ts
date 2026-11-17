import { handleBookingRequest } from "@/server/services/booking-requests";

export const dynamic = "force-dynamic";

/** Από ποιες σελίδες δέχεται αιτήματα ο browser (CORS). Επιπλέον origins: NIDO_BOOKING_ORIGINS (χωρισμένα με κόμμα). */
const DEFAULT_ORIGINS = ["https://nidovillage.gr", "https://www.nidovillage.gr"];
const MAX_BODY_BYTES = 10_000;

function allowedOrigins(): string[] {
  const extra = (process.env.NIDO_BOOKING_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
  return [...DEFAULT_ORIGINS, ...extra];
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(body: unknown, status: number, origin: string | null, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store", ...extra } });
}

/** Η IP του επισκέπτη: στο Cloudflare από το cf-connecting-ip, αλλιώς από τον reverse proxy. */
function clientIp(req: Request): string {
  const h = req.headers;
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Διαβάζει το σώμα του αιτήματος μέχρι `max` bytes. null αν είναι μεγαλύτερο (σταματά να διαβάζει μόλις το ξεπεράσει,
 * ώστε ένα δημόσιο σημείο να μη φορτώνει στη μνήμη ό,τι του στείλουν).
 */
async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Preflight του browser πριν από το POST με JSON. */
export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

/**
 * Αίτημα κράτησης από τη φόρμα του site.
 * JSON: { type: "party"|"wedding"|"christening", date: "YYYY-MM-DD", name, phone, email?, kids?, adults?, message?, consent, website: "" }
 * Απαντήσεις: 200 {ok:true} · 400 {ok:false,error:"invalid",fields} · 403 (άγνωστο origin) · 413 · 429 (όριο ανά IP) · 500
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  // Browser από άλλη σελίδα: δεν δεχόμαστε το αίτημα. Χωρίς Origin (server σε server) επιτρέπεται.
  if (origin && !allowedOrigins().includes(origin)) return json({ ok: false, error: "origin" }, 403, origin);
  let payload: unknown;
  try {
    const text = await readBodyCapped(req, MAX_BODY_BYTES);
    if (text === null) return json({ ok: false, error: "too_large" }, 413, origin);
    payload = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid", fields: { body: "Μη έγκυρο JSON" } }, 400, origin);
  }
  try {
    const out = await handleBookingRequest(payload, clientIp(req));
    return json(out.body, out.status, origin, out.status === 429 ? { "Retry-After": "3600" } : {});
  } catch (e) {
    console.error("[nido] booking-request:", e);
    return json({ ok: false, error: "server" }, 500, origin);
  }
}
