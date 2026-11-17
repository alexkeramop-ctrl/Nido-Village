import { getSessionUser, hasRole } from "@/server/auth";
import { requestOrigin } from "@/server/origin";
import { connectDrive, DriveError, GOOGLE_STATE_COOKIE, verifyOAuthState, type DriveFlashKey } from "@/server/services/google-drive";

export const dynamic = "force-dynamic";

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Επιστροφή από τη Google (μόνο διαχειριστής): έλεγχος state, ανταλλαγή κωδικού, αποθήκευση κρυπτογραφημένου token. */
export async function GET(req: Request) {
  const origin = requestOrigin(req.headers, req.url);
  const url = new URL(req.url);
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  const back = (result: DriveFlashKey) => {
    const to = new URL(`${origin}/admin/settings`);
    to.searchParams.set("drive", result);
    to.hash = "google-drive";
    return new Response(null, {
      status: 302,
      headers: {
        location: to.toString(),
        // Το state είναι μίας χρήσης.
        "set-cookie": `${GOOGLE_STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
        "cache-control": "no-store",
      },
    });
  };

  const me = await getSessionUser();
  if (!me) return Response.redirect(`${origin}/login?next=/admin/settings`, 302);
  if (!hasRole(me, "admin")) return Response.json({ error: "Μόνο ο διαχειριστής μπορεί να συνδέσει το Google Drive" }, { status: 403 });

  try {
    const { redirectUri } = await verifyOAuthState({ state: url.searchParams.get("state"), cookie: cookieValue(req.headers.get("cookie"), GOOGLE_STATE_COOKIE), userId: me.id });
    if (url.searchParams.get("error")) return back("denied");
    const code = url.searchParams.get("code");
    if (!code) return back("state");
    await connectDrive({ code, redirectUri }, me.id);
    return back("connected");
  } catch (e) {
    if (e instanceof DriveError) return back(e.key);
    // Ποτέ το ίδιο το σφάλμα στο log: μπορεί να περιέχει στοιχεία της απάντησης της Google.
    console.error("[nido] google callback:", e instanceof Error ? e.name : "error");
    return back("error");
  }
}
