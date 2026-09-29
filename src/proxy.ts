import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/login", "/partners/login", "/api/health", "/api/sync", "/api/public", "/api/assets", "/order", "/pickup", "/manifest.webmanifest"];

function secret() {
  return new TextEncoder().encode(process.env.NIDO_SECRET ?? "nido-village-dev-secret-change-me");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  if (pathname.startsWith("/partners")) {
    const token = req.cookies.get("nido_partner")?.value;
    if (token) {
      try {
        await jwtVerify(token, secret());
        return NextResponse.next();
      } catch {
        /* fallthrough */
      }
    }
    return NextResponse.redirect(new URL("/partners/login", req.url));
  }

  const token = req.cookies.get("nido_session")?.value;
  if (token) {
    try {
      await jwtVerify(token, secret());
      return NextResponse.next();
    } catch {
      /* fallthrough */
    }
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL("/login", req.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.png$|.*\\.svg$).*)"],
};
