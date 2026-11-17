import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { employeeByName, seeded } from "./helpers";
import { signSession, type SessionUser } from "@/server/auth";
import { decryptPin } from "@/server/pin";
import {
  DRIVE_SCOPE,
  DriveError,
  GOOGLE_STATE_COOKIE,
  buildGoogleAuthUrl,
  buildMultipartBody,
  connectDrive,
  createOAuthState,
  disconnectDrive,
  driveFlash,
  driveStatus,
  googleRedirectUri,
  resetDriveCache,
  testDriveUpload,
  trashDriveFile,
  uploadInvoiceToDrive,
  verifyOAuthState,
} from "@/server/services/google-drive";
import { invoiceFeatures, uploadInvoiceFile } from "@/server/services/invoice-files";
import { requestOrigin } from "@/server/origin";

/** Το session cookie που «βλέπει» ο server μέσα στα route handlers. */
const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "nido_session" && session.token ? { name, value: session.token } : undefined) }),
  headers: async () => new Headers(),
}));

import { GET as connectRoute } from "@/app/api/google/connect/route";
import { GET as callbackRoute } from "@/app/api/google/callback/route";
import { POST as uploadRoute } from "@/app/api/invoices/upload/route";

const REFRESH = "1//0g-REFRESH-token-do-not-store-in-clear-AbCdEf";
const ORIGIN = "https://pda.example.gr";
const REDIRECT = `${ORIGIN}/api/google/callback`;
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const FOLDER = "application/vnd.google-apps.folder";

type Call = { url: URL; method: string; headers: Record<string, string>; body: string | Uint8Array | undefined; form: URLSearchParams | null; json: Record<string, unknown> | null };
type Handler = (call: Call) => Response | null | undefined | Promise<Response | null | undefined>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Ψεύτικη Google μέσα στη μνήμη: token endpoint + Drive v3. Κανένα πραγματικό αίτημα δικτύου. */
function fakeGoogle(override?: Handler) {
  const calls: Call[] = [];
  const files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; trashed: boolean; bytes?: Uint8Array }>();
  const state = { access: 0, validAccess: new Set<string>(), revoked: [] as string[] };
  let nextId = 1;
  const issue = () => {
    const t = `ya29.access-${++state.access}`;
    state.validAccess.add(t);
    return t;
  };
  const handler = async (call: Call): Promise<Response> => {
    const special = await override?.(call);
    if (special) return special;
    const { url, method } = call;
    if (url.href === "https://oauth2.googleapis.com/token") {
      const grant = call.form?.get("grant_type");
      if (grant === "authorization_code") return json({ access_token: issue(), expires_in: 3599, refresh_token: REFRESH, scope: DRIVE_SCOPE, token_type: "Bearer" });
      if (grant === "refresh_token") {
        if (call.form?.get("refresh_token") !== REFRESH) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
        return json({ access_token: issue(), expires_in: 3599, scope: DRIVE_SCOPE, token_type: "Bearer" });
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (url.href === "https://oauth2.googleapis.com/revoke") {
      state.revoked.push(call.form?.get("token") ?? "");
      return json({});
    }
    if (url.hostname !== "www.googleapis.com") throw new Error(`unexpected host ${url.hostname}`);
    const bearer = (call.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!state.validAccess.has(bearer)) return json({ error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } }, 401);
    if (url.pathname === "/drive/v3/about") return json({ user: { emailAddress: "owner@example.gr" } });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const m = q.match(/^name = '(.*)' and mimeType = '(.*)' and '(.*)' in parents and trashed = false$/);
      if (!m) return json({ error: { code: 400, message: "bad q" } }, 400);
      const found = [...files.values()].filter((f) => f.name === m[1] && f.mimeType === m[2] && f.parents.includes(m[3]) && !f.trashed);
      return json({ files: found.map((f) => ({ id: f.id, name: f.name })) });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const id = `folder-${nextId++}`;
      const b = call.json as { name: string; mimeType: string; parents: string[] };
      files.set(id, { id, name: b.name, mimeType: b.mimeType, parents: b.parents, trashed: false });
      return json({ id });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      const parsed = parseMultipart(call);
      const id = `file-${nextId++}`;
      files.set(id, { id, name: parsed.metadata.name as string, mimeType: parsed.contentType, parents: parsed.metadata.parents as string[], trashed: false, bytes: parsed.bytes });
      return json({ id, name: parsed.metadata.name, webViewLink: `https://drive.google.com/file/d/${id}/view?usp=drivesdk` });
    }
    const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (one) {
      const f = files.get(decodeURIComponent(one[1]));
      if (!f) return json({ error: { code: 404, message: "File not found", errors: [{ reason: "notFound" }] } }, 404);
      if (method === "PATCH") {
        if ((call.json as { trashed?: boolean }).trashed) f.trashed = true;
        return json({ id: f.id });
      }
      return json({ id: f.id, trashed: f.trashed });
    }
    throw new Error(`unexpected request ${method} ${url.href}`);
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const raw = init?.body;
    const body = typeof raw === "string" ? raw : raw instanceof Uint8Array ? raw : undefined;
    const type = headers["content-type"] ?? "";
    const call: Call = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body,
      form: typeof body === "string" && type.includes("x-www-form-urlencoded") ? new URLSearchParams(body) : null,
      json: typeof body === "string" && type.includes("application/json") ? (JSON.parse(body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    files,
    state,
    /** Τα αιτήματα από ένα σημείο και μετά, ως "METHOD host/path". */
    since: (n: number) => calls.slice(n).map((c) => `${c.method} ${c.url.hostname}${c.url.pathname}`),
    folder: (name: string, parent: string) => [...files.values()].find((f) => f.name === name && f.mimeType === FOLDER && f.parents.includes(parent)),
    expireAccessTokens: () => state.validAccess.clear(),
  };
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Διαβάζει ένα σώμα multipart/related όπως το θέλει το Drive: μέρος 1 JSON μεταδεδομένα, μέρος 2 τα bytes. */
function parseMultipart(call: Pick<Call, "headers" | "body">) {
  const type = call.headers["content-type"] ?? "";
  const boundary = type.match(/^multipart\/related; boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error(`not multipart/related: ${type}`);
  const body = call.body as Uint8Array;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const delim = enc.encode(`--${boundary}`);
  const first = indexOfBytes(body, delim);
  const second = indexOfBytes(body, delim, first + delim.length);
  const last = indexOfBytes(body, enc.encode(`\r\n--${boundary}--`), second + delim.length);
  expect(first).toBe(0);
  expect(second).toBeGreaterThan(0);
  expect(last).toBeGreaterThan(second);
  const part = (from: number, to: number) => {
    const sep = indexOfBytes(body, enc.encode("\r\n\r\n"), from);
    return { head: dec.decode(body.subarray(from, sep)).trim(), data: body.subarray(sep + 4, to) };
  };
  const p1 = part(first + delim.length, second - 2);
  const p2 = part(second + delim.length, last);
  return {
    boundary,
    metaHead: p1.head,
    metadata: JSON.parse(dec.decode(p1.data)) as Record<string, unknown>,
    contentType: p2.head.replace(/^Content-Type:\s*/i, ""),
    bytes: new Uint8Array(p2.data),
    tail: dec.decode(body.subarray(last)),
  };
}

async function storedRow() {
  const db = await getDb();
  return (await db.query.settings.findFirst({ where: eq(schema.settings.key, "google_drive") })) ?? null;
}

let admin: SessionUser;
let waiter: SessionUser;

beforeAll(async () => {
  await seeded();
  const a = await employeeByName("Αλέξης");
  const w = await employeeByName("Μαρία");
  admin = { id: a.id, name: a.name, role: a.role };
  waiter = { id: w.id, name: w.name, role: w.role };
});

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = "1234-abc.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-client-secret";
  process.env.NIDO_SECRET = "test-secret";
  session.token = null;
  resetDriveCache();
  await (await getDb()).delete(schema.settings).where(eq(schema.settings.key, "google_drive"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OAuth state", () => {
  it("accepts only the exact state of the cookie, for the same admin", async () => {
    const state = await createOAuthState(admin.id, REDIRECT);
    await expect(verifyOAuthState({ state, cookie: state, userId: admin.id })).resolves.toEqual({ redirectUri: REDIRECT });

    const other = await createOAuthState(admin.id, REDIRECT);
    expect(other).not.toBe(state); // τυχαίο nonce: κάθε σύνδεση έχει δικό της state
    const rejects = (input: Parameters<typeof verifyOAuthState>[0]) => expect(verifyOAuthState(input)).rejects.toMatchObject({ name: "DriveError", code: "state", key: "state" });
    await rejects({ state, cookie: other, userId: admin.id }); // γνήσιο αλλά όχι αυτό του cookie (CSRF)
    await rejects({ state, cookie: null, userId: admin.id });
    await rejects({ state: null, cookie: state, userId: admin.id });
    await rejects({ state: "", cookie: "", userId: admin.id });
    await rejects({ state, cookie: state, userId: admin.id + 1 }); // άλλος χρήστης στο ίδιο browser
  });

  it("rejects forged, tampered and expired states", async () => {
    const state = await createOAuthState(admin.id, REDIRECT);
    const rejects = (s: string) => expect(verifyOAuthState({ state: s, cookie: s, userId: admin.id })).rejects.toMatchObject({ code: "state" });

    const [h, p, sig] = state.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
    const forgedPayload = Buffer.from(JSON.stringify({ ...payload, r: "https://evil.example/api/google/callback" })).toString("base64url");
    await rejects(`${h}.${forgedPayload}.${sig}`);
    await rejects(`${h}.${p}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`);
    await rejects("not-a-jwt");

    // Το cookie σύνδεσης (ίδιο NIDO_SECRET, άλλο κλειδί/audience) δεν περνά ποτέ για state.
    const sessionJwt = await signSession(admin);
    await rejects(sessionJwt);

    // Υπογεγραμμένο με άλλο μυστικό.
    process.env.NIDO_SECRET = "another-secret";
    const foreign = await createOAuthState(admin.id, REDIRECT);
    process.env.NIDO_SECRET = "test-secret";
    await rejects(foreign);

    // Λήγει σε 10 λεπτά.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await expect(verifyOAuthState({ state, cookie: state, userId: admin.id })).resolves.toBeTruthy();
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await rejects(state);
  });

  it("builds the Google consent URL with drive.file, offline access and the exact redirect URI", () => {
    const u = new URL(buildGoogleAuthUrl({ redirectUri: REDIRECT, state: "STATE123" }));
    expect(`${u.origin}${u.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "1234-abc.apps.googleusercontent.com",
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: "STATE123",
    });
    expect(u.href).not.toContain("GOCSPX");
    expect(googleRedirectUri("https://pda.example.gr/")).toBe(REDIRECT);
    expect(requestOrigin(new Headers({ host: "internal:3000", "x-forwarded-host": "pda.example.gr", "x-forwarded-proto": "https" }))).toBe(ORIGIN);
    expect(requestOrigin(new Headers({ host: "localhost:3102" }))).toBe("http://localhost:3102");
    expect(requestOrigin(new Headers(), "https://pda.example.gr/api/google/connect?x=1")).toBe(ORIGIN);
  });
});

describe("connecting", () => {
  it("exchanges the code and stores the refresh token encrypted, never in clear", async () => {
    const g = fakeGoogle();
    const log = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const res = await connectDrive({ code: "4/0AUTH-code", redirectUri: REDIRECT }, admin.id);
    expect(res).toEqual({ email: "owner@example.gr" });

    // Το αίτημα ανταλλαγής.
    const token = g.calls[0];
    expect(token.method).toBe("POST");
    expect(token.url.href).toBe("https://oauth2.googleapis.com/token");
    expect(token.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(token.form!)).toEqual({
      client_id: "1234-abc.apps.googleusercontent.com",
      client_secret: "GOCSPX-test-client-secret",
      grant_type: "authorization_code",
      code: "4/0AUTH-code",
      redirect_uri: REDIRECT,
    });
    expect(g.calls[1].url.pathname).toBe("/drive/v3/about");
    expect(g.calls[1].headers.authorization).toBe("Bearer ya29.access-1");

    // Τι γράφτηκε στη βάση.
    const row = await storedRow();
    const value = row!.value as { refreshTokenEnc: string; email: string; connectedAt: string; folders: Record<string, string> };
    expect(value.email).toBe("owner@example.gr");
    expect(value.folders).toEqual({});
    expect(value.refreshTokenEnc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(value.refreshTokenEnc).not.toContain(REFRESH);
    // Κύκλος κρυπτογράφησης: με το ίδιο NIDO_SECRET επιστρέφει το token, με άλλο τίποτα.
    expect(decryptPin(value.refreshTokenEnc)).toBe(REFRESH);
    process.env.NIDO_SECRET = "another-secret";
    expect(decryptPin(value.refreshTokenEnc)).toBeNull();
    process.env.NIDO_SECRET = "test-secret";
    // Αλλοιωμένο κρυπτογράφημα (GCM): απορρίπτεται.
    const [v, iv, tag, ct] = value.refreshTokenEnc.split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(decryptPin([v, iv, tag, flipped.toString("base64")].join(":"))).toBeNull();

    // Πουθενά σε καθαρή μορφή: ούτε σε ρυθμίσεις, ούτε στο ιστορικό, ούτε σε log, ούτε access token στη βάση.
    const db = await getDb();
    const dump = JSON.stringify([await db.query.settings.findMany(), await db.query.auditLog.findMany()]);
    expect(dump).not.toContain(REFRESH);
    expect(dump).not.toContain("ya29.access");
    expect(dump).not.toContain("GOCSPX");
    for (const spy of log) expect(JSON.stringify(spy.mock.calls)).not.toContain(REFRESH);
    const audits = await db.query.auditLog.findMany({ where: eq(schema.auditLog.action, "drive_connect") });
    expect(audits.at(-1)).toMatchObject({ employeeId: admin.id, details: { email: "owner@example.gr" } });

    expect(await driveStatus()).toMatchObject({ configured: true, connected: true, needsReconnect: false, email: "owner@example.gr" });
    expect(await invoiceFeatures()).toMatchObject({ drive: true, driveNeedsReconnect: false });
  });

  it("stores nothing when Google gives no refresh token, the wrong scope or rejects the code", async () => {
    fakeGoogle((c) => (c.form?.get("grant_type") === "authorization_code" ? json({ access_token: "ya29.x", expires_in: 3599, scope: DRIVE_SCOPE }) : null));
    await expect(connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id)).rejects.toMatchObject({ key: "norefresh" });
    expect(await storedRow()).toBeNull();

    fakeGoogle((c) => (c.form?.get("grant_type") === "authorization_code" ? json({ access_token: "ya29.x", refresh_token: REFRESH, scope: "openid email" }) : null));
    await expect(connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id)).rejects.toMatchObject({ key: "noscope" });
    expect(await storedRow()).toBeNull();

    fakeGoogle((c) => (c.url.pathname === "/token" ? json({ error: "invalid_grant" }, 400) : null));
    await expect(connectDrive({ code: "used", redirectUri: REDIRECT }, admin.id)).rejects.toMatchObject({ key: "state" });
    fakeGoogle((c) => (c.url.pathname === "/token" ? json({ error: "redirect_uri_mismatch" }, 400) : null));
    await expect(connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id)).rejects.toThrow(REDIRECT);
    fakeGoogle((c) => (c.url.pathname === "/token" ? json({ error: "invalid_client" }, 401) : null));
    await expect(connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id)).rejects.toMatchObject({ key: "keys" });
    expect(await storedRow()).toBeNull();
    expect(await driveStatus()).toMatchObject({ connected: false });
  });

  it("disconnect revokes the grant at Google and forgets the token", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    await disconnectDrive(admin.id);
    expect(g.state.revoked).toEqual([REFRESH]);
    expect(await storedRow()).toBeNull();
    expect(await driveStatus()).toMatchObject({ connected: false, email: null });
    await expect(uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05" })).rejects.toMatchObject({ code: "not_connected" });

    // Ακόμη κι αν η Google δεν απαντά, η τοπική αποσύνδεση γίνεται.
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    fakeGoogle(() => {
      throw new TypeError("fetch failed");
    });
    await disconnectDrive(admin.id);
    expect(await storedRow()).toBeNull();
  });
});

describe("uploading to Drive", () => {
  it("creates Nido Τιμολόγια/<YYYY>/<MM> on demand and sends a multipart upload", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    resetDriveCache(); // νέο στιγμιότυπο: το access token ζητείται ξανά με το αποθηκευμένο refresh token
    const start = g.calls.length;

    const file = await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05", supplier: "ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ", docNumber: "ΤΔΑ 1532" });

    expect(g.since(start)).toEqual([
      "POST oauth2.googleapis.com/token",
      "GET www.googleapis.com/drive/v3/files", // υπάρχει «Nido Τιμολόγια»;
      "POST www.googleapis.com/drive/v3/files",
      "GET www.googleapis.com/drive/v3/files", // υπάρχει «2026»;
      "POST www.googleapis.com/drive/v3/files",
      "GET www.googleapis.com/drive/v3/files", // υπάρχει «11»;
      "POST www.googleapis.com/drive/v3/files",
      "POST www.googleapis.com/upload/drive/v3/files",
    ]);
    // Ανανέωση με το αποκρυπτογραφημένο refresh token.
    expect(Object.fromEntries(g.calls[start].form!)).toEqual({
      client_id: "1234-abc.apps.googleusercontent.com",
      client_secret: "GOCSPX-test-client-secret",
      grant_type: "refresh_token",
      refresh_token: REFRESH,
    });

    // Φάκελοι: αναζήτηση με όνομα + γονέα, δημιουργία με τον σωστό γονέα.
    const root = g.folder("Nido Τιμολόγια", "root")!;
    const year = g.folder("2026", root.id)!;
    const month = g.folder("11", year.id)!;
    expect(root && year && month).toBeTruthy();
    const search = g.calls[start + 1];
    expect(search.url.searchParams.get("q")).toBe(`name = 'Nido Τιμολόγια' and mimeType = '${FOLDER}' and 'root' in parents and trashed = false`);
    expect(search.url.searchParams.get("fields")).toBe("files(id,name)");
    const create = g.calls[start + 2];
    expect(create.headers["content-type"]).toMatch(/^application\/json/);
    expect(create.json).toEqual({ name: "Nido Τιμολόγια", mimeType: FOLDER, parents: ["root"] });
    expect(g.calls[start + 4].json).toEqual({ name: "2026", mimeType: FOLDER, parents: [root.id] });
    expect(g.calls[start + 6].json).toEqual({ name: "11", mimeType: FOLDER, parents: [year.id] });

    // Το ανέβασμα: multipart/related, πρώτα JSON μεταδεδομένα, μετά τα bytes αυτούσια.
    const up = g.calls[start + 7];
    expect(up.method).toBe("POST");
    expect(up.url.origin + up.url.pathname).toBe("https://www.googleapis.com/upload/drive/v3/files");
    expect(up.url.searchParams.get("uploadType")).toBe("multipart");
    expect(up.url.searchParams.get("fields")).toBe("id,name,webViewLink");
    expect(up.headers.authorization).toMatch(/^Bearer ya29\.access-\d+$/);
    const parsed = parseMultipart(up);
    expect(parsed.boundary).toMatch(/^nido-[0-9a-f]{24}$/);
    expect(parsed.metaHead).toBe("Content-Type: application/json; charset=UTF-8");
    expect(parsed.metadata).toEqual({ name: "2026-11-05 ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ ΤΔΑ 1532.pdf", parents: [month.id] });
    expect(parsed.contentType).toBe("application/pdf");
    expect(Buffer.from(parsed.bytes).equals(Buffer.from(PDF))).toBe(true);
    expect(parsed.tail).toBe(`\r\n--${parsed.boundary}--\r\n`);

    expect(file).toEqual({ fileId: expect.stringMatching(/^file-/), name: "2026-11-05 ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ ΤΔΑ 1532.pdf", url: expect.stringMatching(/^https:\/\/drive\.google\.com\/file\/d\/file-\d+\/view/) });

    // Τα id των φακέλων κρατιούνται στις ρυθμίσεις.
    const value = (await storedRow())!.value as { folders: Record<string, string> };
    expect(value.folders).toEqual({ "Nido Τιμολόγια": root.id, "Nido Τιμολόγια/2026": year.id, "Nido Τιμολόγια/2026/11": month.id });

    // Δεύτερο τιμολόγιο του ίδιου μήνα: ούτε αναζήτηση ούτε δημιουργία φακέλων, ούτε νέο token.
    const second = g.calls.length;
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const f2 = await uploadInvoiceToDrive({ bytes: jpg, kind: "jpg", date: "2026-11-28", supplier: "Φούρνος/Κώστα: «Α»", docNumber: "12/Β" });
    expect(g.since(second)).toEqual(["GET www.googleapis.com/drive/v3/files/" + month.id, "POST www.googleapis.com/upload/drive/v3/files"]);
    const p2 = parseMultipart(g.calls.at(-1)!);
    expect(p2.metadata).toEqual({ name: "2026-11-28 Φούρνος-Κώστα- «Α» 12-Β.jpg", parents: [month.id] });
    expect(p2.contentType).toBe("image/jpeg");
    expect(Buffer.from(p2.bytes).equals(Buffer.from(jpg))).toBe(true);
    expect(f2.name).toBe("2026-11-28 Φούρνος-Κώστα- «Α» 12-Β.jpg");

    // Άλλος μήνας: ξαναχρησιμοποιεί ρίζα και έτος, φτιάχνει μόνο τον μήνα.
    const third = g.calls.length;
    await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-12-01", supplier: "Χ" });
    const dec = g.folder("12", year.id)!;
    expect(g.since(third)).toEqual([
      `GET www.googleapis.com/drive/v3/files/${root.id}`,
      `GET www.googleapis.com/drive/v3/files/${year.id}`,
      "GET www.googleapis.com/drive/v3/files",
      "POST www.googleapis.com/drive/v3/files",
      "POST www.googleapis.com/upload/drive/v3/files",
    ]);
    expect(parseMultipart(g.calls.at(-1)!).metadata).toEqual({ name: "2026-12-01 Χ.pdf", parents: [dec.id] });
  });

  it("recreates a folder the owner deleted or trashed in Drive", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05", supplier: "Α" });
    const root = g.folder("Nido Τιμολόγια", "root")!;
    const year = g.folder("2026", root.id)!;
    const month = g.folder("11", year.id)!;
    month.trashed = true;

    const f = await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-06", supplier: "Β" });
    const fresh = [...g.files.values()].find((x) => x.name === "11" && !x.trashed && x.parents.includes(year.id))!;
    expect(fresh.id).not.toBe(month.id);
    expect(g.files.get(f.fileId)?.parents).toEqual([fresh.id]);
    expect(((await storedRow())!.value as { folders: Record<string, string> }).folders["Nido Τιμολόγια/2026/11"]).toBe(fresh.id);
    // Δεν έγιναν διπλοί φάκελοι για ρίζα και έτος.
    expect([...g.files.values()].filter((x) => x.name === "Nido Τιμολόγια").length).toBe(1);
    expect([...g.files.values()].filter((x) => x.name === "2026").length).toBe(1);
  });

  it("refreshes the access token on 401 and retries once", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05", supplier: "Α" });
    // Το access token που έχει στη μνήμη ο server παύει να ισχύει στη Google.
    g.expireAccessTokens();
    const start = g.calls.length;

    const f = await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-07", supplier: "Β" });
    expect(f.name).toBe("2026-11-07 Β.pdf");
    const seq = g.since(start);
    expect(seq.slice(0, 3)).toEqual([expect.stringMatching(/^GET www\.googleapis\.com\/drive\/v3\/files\/folder-/), "POST oauth2.googleapis.com/token", expect.stringMatching(/^GET www\.googleapis\.com\/drive\/v3\/files\/folder-/)]);
    expect(seq.at(-1)).toBe("POST www.googleapis.com/upload/drive/v3/files");
    expect(seq.filter((s) => s.includes("/token"))).toHaveLength(1);
    const [first, refresh, retry] = g.calls.slice(start);
    expect(first.headers.authorization).toBe("Bearer ya29.access-1");
    expect(refresh.form!.get("grant_type")).toBe("refresh_token");
    expect(refresh.form!.get("refresh_token")).toBe(REFRESH);
    expect(retry.headers.authorization).toBe("Bearer ya29.access-2");
    expect(retry.url.href).toBe(first.url.href);
    expect(g.calls.at(-1)!.headers.authorization).toBe("Bearer ya29.access-2");
    expect(await driveStatus()).toMatchObject({ needsReconnect: false });
  });

  it("asks to reconnect when the refresh token was revoked or expired", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    resetDriveCache();
    fakeGoogle((c) => (c.url.pathname === "/token" ? json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400) : null));
    const p = uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05", supplier: "Α" });
    await expect(p).rejects.toBeInstanceOf(DriveError);
    await expect(p).rejects.toMatchObject({ code: "reconnect", message: expect.stringMatching(/έληξε ή ανακλήθηκε.*Ρυθμίσεις → Google Drive/) });
    expect(await driveStatus()).toMatchObject({ connected: true, needsReconnect: true });
    expect(await invoiceFeatures()).toMatchObject({ drive: true, driveNeedsReconnect: true });
    expect(g.files.size).toBe(0);

    // 401 ακόμη και μετά την ανανέωση: ίδιο καθαρό μήνυμα, όχι ατέρμονες προσπάθειες.
    await (await getDb()).delete(schema.settings).where(eq(schema.settings.key, "google_drive"));
    const g2 = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const g3 = fakeGoogle((c) => (c.url.hostname === "www.googleapis.com" ? json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401) : null));
    await expect(uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05" })).rejects.toMatchObject({ code: "reconnect" });
    expect(g3.since(0)).toEqual(["GET www.googleapis.com/drive/v3/files", "POST oauth2.googleapis.com/token", "GET www.googleapis.com/drive/v3/files"]);
    expect(await driveStatus()).toMatchObject({ needsReconnect: true });
    expect(g2.files.size).toBe(0);

    // Άλλαξε το NIDO_SECRET: το αποθηκευμένο κλειδί δεν διαβάζεται, ζητείται νέα σύνδεση (χωρίς αίτημα στη Google).
    resetDriveCache();
    process.env.NIDO_SECRET = "rotated-secret";
    const g4 = fakeGoogle();
    await expect(uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05" })).rejects.toMatchObject({ code: "reconnect", message: expect.stringMatching(/NIDO_SECRET/) });
    expect(g4.calls).toHaveLength(0);
  });

  it("turns Drive and network failures into clear Greek messages", async () => {
    fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const upload = () => uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05", supplier: "Α" });
    await upload();
    const failUpload = (res: () => Response) => fakeGoogle((c) => (c.url.pathname.startsWith("/upload/") ? res() : null));

    failUpload(() => json({ error: { code: 403, message: "The user's Drive storage quota has been exceeded.", errors: [{ reason: "storageQuotaExceeded" }] } }, 403));
    resetDriveCache();
    // Η ψεύτικη Google ξεκινά άδεια: οι φάκελοι ξαναφτιάχνονται και το ανέβασμα αποτυγχάνει στο όριο χώρου.
    await expect(upload()).rejects.toMatchObject({ code: "quota", message: expect.stringMatching(/χώρος στο Google Drive έχει γεμίσει/) });

    failUpload(() => json({ error: { code: 429, errors: [{ reason: "userRateLimitExceeded" }] } }, 429));
    resetDriveCache();
    await expect(upload()).rejects.toThrow(/Πολλά αιτήματα/);

    failUpload(() => json({ error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "accessNotConfigured" }] } }, 403));
    resetDriveCache();
    await expect(upload()).rejects.toThrow(/Google Drive API δεν είναι ενεργοποιημένο/);

    failUpload(() => new Response("<html>Backend Error</html>", { status: 503 }));
    resetDriveCache();
    await expect(upload()).rejects.toMatchObject({ code: "api", message: expect.stringMatching(/σφάλμα 503.*Δοκίμασε ξανά/) });

    fakeGoogle(() => {
      throw new TypeError("fetch failed");
    });
    resetDriveCache();
    const offline = upload();
    await expect(offline).rejects.toBeInstanceOf(DriveError);
    await expect(offline).rejects.toMatchObject({ code: "network", message: expect.stringMatching(/Δεν υπάρχει επικοινωνία με τη Google/) });
    // Ένα σφάλμα δικτύου δεν σημαίνει ότι χάθηκε η σύνδεση.
    expect(await driveStatus()).toMatchObject({ connected: true, needsReconnect: false });

    // Κανένα μήνυμα δεν περιέχει μυστικά.
    for (const p of [upload()]) await p.catch((e: Error) => expect(e.message).not.toMatch(/ya29|GOCSPX|1\/\/0g/));
  });

  it("moves a file to the Drive trash, and tolerates a file that is already gone", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const f = await uploadInvoiceToDrive({ bytes: PDF, kind: "pdf", date: "2026-11-05", supplier: "Α" });
    const start = g.calls.length;
    await expect(trashDriveFile(f.fileId)).resolves.toBe("trashed");
    const call = g.calls[start];
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe(`/drive/v3/files/${f.fileId}`);
    expect(call.json).toEqual({ trashed: true });
    expect(g.files.get(f.fileId)?.trashed).toBe(true);
    await expect(trashDriveFile("no-such-file")).resolves.toBe("missing");
  });

  it("test upload puts a small text file in the root folder", async () => {
    const g = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const f = await testDriveUpload(new Date("2026-11-17T09:30:00Z"));
    const root = g.folder("Nido Τιμολόγια", "root")!;
    expect(f.name).toBe("Δοκιμή σύνδεσης 2026-11-17 09.30.txt");
    expect(g.files.get(f.fileId)).toMatchObject({ parents: [root.id], mimeType: "text/plain; charset=UTF-8" });
    expect(new TextDecoder().decode(g.files.get(f.fileId)!.bytes)).toContain("Δοκιμή σύνδεσης Nido Village PDA");
    expect(f.url).toMatch(/^https:\/\/drive\.google\.com\//);
  });

  it("builds a byte-exact multipart body", () => {
    const body = buildMultipartBody({ name: "α.pdf", parents: ["p1"] }, new Uint8Array([0, 255, 13, 10, 45, 45]), "application/pdf", "b0");
    const text = Buffer.from(body).toString("latin1");
    expect(text.startsWith("--b0\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n")).toBe(true);
    expect(text.endsWith("\r\n--b0--\r\n")).toBe(true);
    const parsed = parseMultipart({ headers: { "content-type": "multipart/related; boundary=b0" }, body });
    expect(parsed.metadata).toEqual({ name: "α.pdf", parents: ["p1"] });
    expect([...parsed.bytes]).toEqual([0, 255, 13, 10, 45, 45]);
  });
});

describe("/api/google routes (admin only)", () => {
  const cookieOf = (res: Response) => res.headers.get("set-cookie") ?? "";

  it("connect: needs an admin, sets an httpOnly state cookie and redirects to Google", async () => {
    const g = fakeGoogle();
    const req = () => new Request(`${ORIGIN}/api/google/connect`);

    const anon = await connectRoute(req());
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe(`${ORIGIN}/login?next=/admin/settings`);
    expect(cookieOf(anon)).toBe("");

    session.token = await signSession(waiter);
    const forbidden = await connectRoute(req());
    expect(forbidden.status).toBe(403);
    expect(cookieOf(forbidden)).toBe("");

    session.token = await signSession(admin);
    const res = await connectRoute(req());
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(to.searchParams.get("scope")).toBe(DRIVE_SCOPE);
    const state = to.searchParams.get("state")!;
    const cookie = cookieOf(res);
    expect(cookie).toContain(`${GOOGLE_STATE_COOKIE}=${state};`);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; Path=\/api\/google/);
    expect(cookie).toMatch(/; Max-Age=600/);
    await expect(verifyOAuthState({ state, cookie: state, userId: admin.id })).resolves.toEqual({ redirectUri: REDIRECT });
    expect(g.calls).toHaveLength(0); // κανένα αίτημα από τον server σε αυτό το βήμα

    delete process.env.GOOGLE_CLIENT_SECRET;
    const missing = await connectRoute(req());
    expect(missing.headers.get("location")).toBe(`${ORIGIN}/admin/settings?drive=missing#google-drive`);
  });

  it("callback: verifies the state before exchanging the code", async () => {
    const g = fakeGoogle();
    const back = (key: string) => `${ORIGIN}/admin/settings?drive=${key}#google-drive`;
    const call = (query: string, cookie?: string) => callbackRoute(new Request(`${ORIGIN}/api/google/callback?${query}`, { headers: cookie ? { cookie } : {} }));
    const state = await createOAuthState(admin.id, REDIRECT);
    const good = `other=1; ${GOOGLE_STATE_COOKIE}=${state}; theme=light`;

    // Χωρίς σύνδεση ή χωρίς ρόλο διαχειριστή: τίποτα.
    expect((await call(`code=abc&state=${state}`, good)).headers.get("location")).toBe(`${ORIGIN}/login?next=/admin/settings`);
    session.token = await signSession(waiter);
    expect((await call(`code=abc&state=${state}`, good)).status).toBe(403);
    expect(g.calls).toHaveLength(0);

    session.token = await signSession(admin);
    // Λάθος/ελλιπές state: επιστροφή με μήνυμα, καμία ανταλλαγή κωδικού, το cookie σβήνεται.
    for (const res of [
      await call(`code=abc&state=${state}`), // χωρίς cookie
      await call(`code=abc&state=${state}`, `${GOOGLE_STATE_COOKIE}=${await createOAuthState(admin.id, REDIRECT)}`), // άλλο state στο cookie
      await call(`code=abc&state=forged`, `${GOOGLE_STATE_COOKIE}=forged`),
      await call(`code=abc`, good),
    ]) {
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(back("state"));
      expect(cookieOf(res)).toMatch(new RegExp(`^${GOOGLE_STATE_COOKIE}=; .*Max-Age=0`));
    }
    expect(g.calls).toHaveLength(0);
    expect(await storedRow()).toBeNull();

    // Ο χρήστης πάτησε «Άκυρο» στη Google.
    expect((await call(`error=access_denied&state=${state}`, good)).headers.get("location")).toBe(back("denied"));
    expect(g.calls).toHaveLength(0);

    // Κανονική επιστροφή.
    const ok = await call(`code=4/0AUTH&scope=${encodeURIComponent(DRIVE_SCOPE)}&state=${state}`, good);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe(back("connected"));
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(cookieOf(ok)).toMatch(/Max-Age=0/);
    expect(g.calls[0].form!.get("code")).toBe("4/0AUTH");
    expect(g.calls[0].form!.get("redirect_uri")).toBe(REDIRECT);
    expect(decryptPin(((await storedRow())!.value as { refreshTokenEnc: string }).refreshTokenEnc)).toBe(REFRESH);
    // Τίποτα μυστικό στη διεύθυνση επιστροφής.
    expect(ok.headers.get("location")).not.toMatch(/ya29|1\/\/0g|4\/0AUTH/);

    // Αποτυχία στη Google: γνωστό κλειδί μηνύματος, ποτέ το ίδιο το σφάλμα.
    fakeGoogle((c) => (c.url.pathname === "/token" ? json({ error: "invalid_client", error_description: "secret GOCSPX-test-client-secret is wrong" }, 401) : null));
    const s2 = await createOAuthState(admin.id, REDIRECT);
    const bad = await call(`code=x&state=${s2}`, `${GOOGLE_STATE_COOKIE}=${s2}`);
    expect(bad.headers.get("location")).toBe(back("keys"));
  });

  it("maps return keys to fixed Greek messages (nothing from the URL is echoed)", () => {
    expect(driveFlash(undefined, REDIRECT)).toBeNull();
    expect(driveFlash("connected", REDIRECT)).toMatchObject({ ok: true });
    expect(driveFlash("state", REDIRECT)).toMatchObject({ ok: false, text: expect.stringMatching(/Πάτησε ξανά «Σύνδεση»/) });
    expect(driveFlash("redirect", REDIRECT)!.text).toContain(REDIRECT);
    expect(driveFlash("<script>alert(1)</script>", REDIRECT)).toEqual({ ok: false, text: "Η σύνδεση με το Google Drive απέτυχε. Δοκίμασε ξανά σε λίγο." });
  });
});

describe("POST /api/invoices/upload", () => {
  const form = (fields: Record<string, string>, file?: { bytes: Uint8Array; name: string; type: string }) => {
    const fd = new FormData();
    if (file) fd.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return new Request(`${ORIGIN}/api/invoices/upload`, { method: "POST", body: fd });
  };
  const pdf = { bytes: PDF, name: "scan.pdf", type: "application/pdf" };
  const fields = { date: "2026-11-05", supplier: "ΚΑΒΑ ΑΕ", docNumber: "ΤΔΑ 9" };

  it("is admin only and returns the Drive link for the entry", async () => {
    const g = fakeGoogle();
    const anon = await uploadRoute(form(fields, pdf));
    expect(anon.status).toBe(401);
    session.token = await signSession(waiter);
    expect((await uploadRoute(form(fields, pdf))).status).toBe(403);
    expect(g.calls).toHaveLength(0);

    session.token = await signSession(admin);
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const res = await uploadRoute(form(fields, pdf));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { fileId: string; url: string; name: string } };
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("2026-11-05 ΚΑΒΑ ΑΕ ΤΔΑ 9.pdf");
    expect(body.data.url).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(Buffer.from(g.files.get(body.data.fileId)!.bytes!).equals(Buffer.from(PDF))).toBe(true);
    const audits = await (await getDb()).query.auditLog.findMany({ where: eq(schema.auditLog.action, "invoice_upload") });
    expect(audits.at(-1)).toMatchObject({ employeeId: admin.id, details: { name: "2026-11-05 ΚΑΒΑ ΑΕ ΤΔΑ 9.pdf", bytes: PDF.length } });
  });

  it("refuses wrong files before talking to Google and reports Drive errors as JSON", async () => {
    const g = fakeGoogle();
    session.token = await signSession(admin);
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const start = g.calls.length;
    const err = async (req: Request) => {
      const res = await uploadRoute(req);
      return { status: res.status, ...((await res.json()) as { ok: boolean; error: string; code?: string }) };
    };

    expect(await err(form(fields))).toMatchObject({ status: 400, ok: false, error: expect.stringMatching(/Δεν έφτασε αρχείο/) });
    // Το όνομα και ο τύπος που δηλώνει ο browser δεν μετράνε: κρίνεται από τα bytes.
    expect(await err(form(fields, { bytes: new TextEncoder().encode("#!/bin/sh\nrm -rf / # not a pdf at all"), name: "invoice.pdf", type: "application/pdf" }))).toMatchObject({
      status: 400,
      error: expect.stringMatching(/Επιτρέπονται μόνο PDF/),
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    expect(await err(form(fields, { bytes: big, name: "big.pdf", type: "application/pdf" }))).toMatchObject({ status: 400, error: expect.stringMatching(/10 MB/) });
    expect(await err(form({ ...fields, date: "05/11/2026" }, pdf))).toMatchObject({ status: 400, error: expect.stringMatching(/ημερομηνία/) });
    expect(g.calls.length).toBe(start);

    fakeGoogle((c) => (c.url.pathname === "/token" ? json({ error: "invalid_grant" }, 400) : null));
    resetDriveCache();
    expect(await err(form(fields, pdf))).toMatchObject({ status: 409, ok: false, code: "reconnect", error: expect.stringMatching(/Σύνδεσέ το ξανά/) });

    // Ακριβώς 10 MB επιτρέπονται.
    await (await getDb()).delete(schema.settings).where(eq(schema.settings.key, "google_drive"));
    const g2 = fakeGoogle();
    await connectDrive({ code: "c", redirectUri: REDIRECT }, admin.id);
    const max = new Uint8Array(10 * 1024 * 1024);
    max.set(PDF);
    const file = await uploadInvoiceFile({ bytes: max, date: "2026-11-05", supplier: "Μεγάλο" }, admin.id);
    expect(g2.files.get(file.fileId)!.bytes!.length).toBe(10 * 1024 * 1024);
  });
});
