import { getSessionUser, hasRole } from "@/server/auth";
import { requestOrigin } from "@/server/origin";
import { buildGoogleAuthUrl, createOAuthState, googleKeys, googleRedirectUri, GOOGLE_STATE_COOKIE, GOOGLE_STATE_MINUTES } from "@/server/services/google-drive";

export const dynamic = "force-dynamic";

/** Ξεκινά τη σύνδεση με το Google Drive (μόνο διαχειριστής): state σε httpOnly cookie και μεταφορά στη Google. */
export async function GET(req: Request) {
  const origin = requestOrigin(req.headers, req.url);
  const me = await getSessionUser();
  if (!me) return Response.redirect(`${origin}/login?next=/admin/settings`, 302);
  if (!hasRole(me, "admin")) return Response.json({ error: "Μόνο ο διαχειριστής μπορεί να συνδέσει το Google Drive" }, { status: 403 });
  if (!googleKeys()) return Response.redirect(`${origin}/admin/settings?drive=missing#google-drive`, 302);

  const redirectUri = googleRedirectUri(origin);
  const state = await createOAuthState(me.id, redirectUri);
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      location: buildGoogleAuthUrl({ redirectUri, state }),
      "set-cookie": `${GOOGLE_STATE_COOKIE}=${state}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${GOOGLE_STATE_MINUTES * 60}${secure}`,
      "cache-control": "no-store",
    },
  });
}
