/**
 * Το δημόσιο origin όπως το βλέπει ο browser (πίσω από reverse proxy: x-forwarded-*), π.χ. "https://pda.nidovillage.gr".
 * Ίδιος κανόνας παντού (σελίδα Ρυθμίσεων και /api/google/*), ώστε το redirect URI που δείχνουμε να είναι αυτό που στέλνουμε.
 */
export function requestOrigin(headers: Headers, fallbackUrl?: string): string {
  const first = (v: string | null) => (v ?? "").split(",")[0].trim();
  const host = first(headers.get("x-forwarded-host")) || first(headers.get("host"));
  if (!host) return fallbackUrl ? new URL(fallbackUrl).origin : "http://localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = first(headers.get("x-forwarded-proto")) || (local ? "http" : "https");
  return `${proto}://${host}`;
}
