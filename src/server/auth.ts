/**
 * Σύνδεση υπαλλήλων με PIN.
 * Το PIN αποθηκεύεται ως scrypt hash. Το session είναι υπογεγραμμένο JWT σε cookie.
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EmployeeRole } from "@/db/schema";
import { verifyPin } from "./pin";

export const SESSION_COOKIE = "nido_session";
const SESSION_HOURS = 14;

export type SessionUser = { id: number; name: string; role: EmployeeRole };

function secret(): Uint8Array {
  const s = process.env.NIDO_SECRET ?? "nido-village-dev-secret-change-me";
  return new TextEncoder().encode(s);
}

export { hashPin, verifyPin } from "./pin";

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { id: Number(payload.sub), name: String(payload.name), role: payload.role as EmployeeRole };
  } catch {
    return null;
  }
}

/** Επιστρέφει τον υπάλληλο του PIN ή null. */
export async function loginWithPin(pin: string): Promise<SessionUser | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.employees).where(eq(schema.employees.active, true));
  for (const e of rows) {
    if (verifyPin(pin, e.pinHash)) return { id: e.id, name: e.name, role: e.role };
  }
  return null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Απαιτείται σύνδεση");
  return u;
}

const ROLE_RANK: Record<EmployeeRole, number> = { kitchen: 1, waiter: 2, cashier: 3, manager: 4, admin: 5 };

export function hasRole(user: SessionUser, ...allowed: EmployeeRole[]): boolean {
  return allowed.includes(user.role) || user.role === "admin";
}

export function atLeast(user: SessionUser, role: EmployeeRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[role];
}

export async function requireRole(...allowed: EmployeeRole[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!hasRole(u, ...allowed)) throw new Error("Δεν έχεις δικαίωμα για αυτή την ενέργεια");
  return u;
}

export async function setSessionCookie(user: SessionUser) {
  const store = await cookies();
  const proto = ((await headers()).get("x-forwarded-proto") ?? "").split(",")[0].trim();
  store.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
    secure: proto === "https",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
