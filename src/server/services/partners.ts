/** Χρήστες συνεταίρων (online dashboard, μόνο ανάγνωση). */
import { asc, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb, schema } from "@/db";
import { omit } from "@/server/util";
import { hashPin, verifyPin } from "@/server/pin";

export const PARTNER_COOKIE = "nido_partner";
const HOURS = 24 * 30;

function secret() {
  return new TextEncoder().encode(process.env.NIDO_SECRET ?? "nido-village-dev-secret-change-me");
}

export async function listPartnerUsers() {
  const db = await getDb();
  const rows = await db.query.partnerUsers.findMany({ orderBy: [asc(schema.partnerUsers.name)] });
  return rows.map((r) => omit(r, "passwordHash"));
}

export async function upsertPartnerUser(input: { id?: number; name: string; email: string; password?: string; active?: boolean }) {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Μη έγκυρο email");
  if (input.password !== undefined && input.password !== "" && input.password.length < 8) throw new Error("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες");
  if (input.id) {
    const set: Partial<typeof schema.partnerUsers.$inferInsert> = { name: input.name.trim(), email };
    if (input.active !== undefined) set.active = input.active;
    if (input.password) set.passwordHash = hashPin(input.password);
    const [row] = await db.update(schema.partnerUsers).set(set).where(eq(schema.partnerUsers.id, input.id)).returning();
    return row;
  }
  if (!input.password) throw new Error("Απαιτείται κωδικός");
  const [row] = await db
    .insert(schema.partnerUsers)
    .values({ name: input.name.trim(), email, passwordHash: hashPin(input.password), active: input.active ?? true })
    .returning();
  return row;
}

export type PartnerSession = { id: number; name: string; email: string };

export async function partnerLogin(email: string, password: string): Promise<PartnerSession | null> {
  const db = await getDb();
  const u = await db.query.partnerUsers.findFirst({ where: eq(schema.partnerUsers.email, email.trim().toLowerCase()) });
  if (!u || !u.active || !verifyPin(password, u.passwordHash)) return null;
  await db.update(schema.partnerUsers).set({ lastLoginAt: new Date() }).where(eq(schema.partnerUsers.id, u.id));
  return { id: u.id, name: u.name, email: u.email };
}

export async function setPartnerCookie(p: PartnerSession) {
  const token = await new SignJWT({ name: p.name, email: p.email, kind: "partner" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(p.id))
    .setIssuedAt()
    .setExpirationTime(`${HOURS}h`)
    .sign(secret());
  const store = await cookies();
  store.set(PARTNER_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: HOURS * 3600, secure: process.env.NODE_ENV === "production" });
}

export async function clearPartnerCookie() {
  const store = await cookies();
  store.delete(PARTNER_COOKIE);
}

export async function getPartnerSession(): Promise<PartnerSession | null> {
  const store = await cookies();
  const token = store.get(PARTNER_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "partner" || !payload.sub) return null;
    return { id: Number(payload.sub), name: String(payload.name), email: String(payload.email) };
  } catch {
    return null;
  }
}

/** Δημιουργεί τον πρώτο συνεταίρο από env, για cloud εγκατάσταση χωρίς UI διαχείρισης. */
export async function bootstrapPartnerFromEnv() {
  const email = process.env.PARTNER_BOOTSTRAP_EMAIL;
  const password = process.env.PARTNER_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;
  const db = await getDb();
  const exists = await db.query.partnerUsers.findFirst({ where: eq(schema.partnerUsers.email, email.toLowerCase()) });
  if (exists) return;
  await upsertPartnerUser({ name: process.env.PARTNER_BOOTSTRAP_NAME ?? "Συνεταίρος", email, password });
  console.log(`[nido] Δημιουργήθηκε χρήστης συνεταίρου ${email}`);
}
