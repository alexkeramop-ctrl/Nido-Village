/**
 * Google Drive του ιδιοκτήτη: σύνδεση OAuth 2.0 (web flow) και ανέβασμα παραστατικών.
 *  - Μόνο fetch + WebCrypto (τρέχει και σε Cloudflare Workers, χωρίς βιβλιοθήκες της Google).
 *  - Δικαίωμα drive.file: η εφαρμογή βλέπει ΜΟΝΟ τα αρχεία/φακέλους που δημιούργησε η ίδια.
 *  - Το refresh token αποθηκεύεται κρυπτογραφημένο (AES-256-GCM με κλειδί από το NIDO_SECRET) στον πίνακα settings.
 *    Δεν γράφεται ποτέ σε log, ούτε επιστρέφει στον browser. Τα access tokens ζουν μόνο στη μνήμη.
 */
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { getDb, schema } from "@/db";
import { audit } from "@/server/audit";
import { decryptPin, encryptPin } from "@/server/pin";
import { DRIVE_ROOT_FOLDER, INVOICE_MIME, invoiceFileName, invoiceFolderPath, type InvoiceFileKind } from "@/lib/invoices";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_STATE_COOKIE = "nido_google_state";
export const GOOGLE_STATE_MINUTES = 10;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SETTINGS_KEY = "google_drive";

export type DriveErrorCode = "not_configured" | "not_connected" | "reconnect" | "state" | "denied" | "network" | "quota" | "api";

/** Σφάλμα με μήνυμα έτοιμο για τον χρήστη (ελληνικά, χωρίς μυστικά). */
export class DriveError extends Error {
  constructor(
    public code: DriveErrorCode,
    message: string,
    /** Σύντομο κλειδί για το μήνυμα μετά την επιστροφή από τη Google (δες driveFlash). */
    public key: DriveFlashKey = "error",
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export type DriveFlashKey = "connected" | "denied" | "missing" | "state" | "keys" | "redirect" | "norefresh" | "noscope" | "network" | "apioff" | "error";

const MSG = {
  notConfigured: "Το Google Drive δεν έχει ρυθμιστεί: λείπουν τα GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Δες τα βήματα στις Ρυθμίσεις → Google Drive.",
  notConnected: "Το Google Drive δεν είναι συνδεδεμένο. Σύνδεσέ το από τις Ρυθμίσεις → Google Drive.",
  reconnect: "Η σύνδεση με το Google Drive έληξε ή ανακλήθηκε. Σύνδεσέ το ξανά από τις Ρυθμίσεις → Google Drive.",
  unreadable: "Το αποθηκευμένο κλειδί του Google Drive δεν διαβάζεται (άλλαξε το NIDO_SECRET;). Σύνδεσε ξανά το Drive από τις Ρυθμίσεις.",
  badKeys: "Η Google δεν δέχτηκε τα GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Έλεγξε ότι αντιγράφηκαν σωστά.",
  network: "Δεν υπάρχει επικοινωνία με τη Google αυτή τη στιγμή. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
  state: "Η σύνδεση με τη Google δεν επιβεβαιώθηκε (έληξε ο χρόνος ή άνοιξε από άλλο παράθυρο). Πάτησε ξανά «Σύνδεση».",
  noRefresh: "Η Google δεν έδωσε μόνιμη άδεια. Αφαίρεσε την εφαρμογή από το myaccount.google.com/permissions και πάτησε ξανά «Σύνδεση».",
  noScope: "Δεν δόθηκε άδεια για το Google Drive. Πάτησε ξανά «Σύνδεση» και άφησε τσεκαρισμένη την πρόσβαση στο Drive.",
  quota: "Ο χώρος στο Google Drive έχει γεμίσει. Ελευθέρωσε χώρο και δοκίμασε ξανά.",
  rate: "Πολλά αιτήματα προς το Google Drive. Περίμενε λίγο και δοκίμασε ξανά.",
  apiOff: "Το Google Drive API δεν είναι ενεργοποιημένο στο έργο της Google (APIs & Services → Library → Google Drive API → Enable).",
};

/** Μήνυμα για τη σελίδα Ρυθμίσεων μετά την επιστροφή από τη Google (?drive=<κλειδί>). Μόνο γνωστά κλειδιά: τίποτα από το URL δεν εμφανίζεται αυτούσιο. */
export function driveFlash(key: string | undefined, redirectUri: string): { ok: boolean; text: string } | null {
  if (!key) return null;
  const map: Record<DriveFlashKey, string> = {
    connected: "Το Google Drive συνδέθηκε. Πάτησε «Δοκιμαστικό ανέβασμα» για έλεγχο.",
    denied: "Η σύνδεση ακυρώθηκε: δεν δόθηκε άδεια στη Google. Πάτησε ξανά «Σύνδεση» όταν είσαι έτοιμος.",
    missing: MSG.notConfigured,
    state: MSG.state,
    keys: MSG.badKeys,
    redirect: `Το redirect URI δεν ταιριάζει. Στο Google Cloud (Credentials → OAuth client → Authorized redirect URIs) βάλε ακριβώς: ${redirectUri}`,
    norefresh: MSG.noRefresh,
    noscope: MSG.noScope,
    network: MSG.network,
    apioff: MSG.apiOff,
    error: "Η σύνδεση με το Google Drive απέτυχε. Δοκίμασε ξανά σε λίγο.",
  };
  return { ok: key === "connected", text: map[key as DriveFlashKey] ?? map.error };
}

/* ------------------------------ Ρυθμίσεις ------------------------------ */

export function googleKeys(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function requireKeys() {
  const k = googleKeys();
  if (!k) throw new DriveError("not_configured", MSG.notConfigured, "missing");
  return k;
}

export const googleRedirectUri = (origin: string) => `${origin.replace(/\/+$/, "")}/api/google/callback`;

type StoredDrive = {
  /** AES-256-GCM, μορφή "v1:iv:tag:ciphertext". Ποτέ το ίδιο το token. */
  refreshTokenEnc: string;
  email: string | null;
  connectedAt: string;
  /** id φακέλων ανά διαδρομή ("Nido Τιμολόγια/2026/11"), για να μην ψάχνουμε κάθε φορά. */
  folders: Record<string, string>;
  needsReconnect?: boolean;
};

async function readStored(): Promise<StoredDrive | null> {
  const db = await getDb();
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, SETTINGS_KEY) });
  const v = row?.value as Partial<StoredDrive> | undefined;
  if (!v || typeof v.refreshTokenEnc !== "string" || !v.refreshTokenEnc) return null;
  return { refreshTokenEnc: v.refreshTokenEnc, email: v.email ?? null, connectedAt: v.connectedAt ?? "", folders: { ...(v.folders ?? {}) }, needsReconnect: v.needsReconnect === true };
}

async function writeStored(value: StoredDrive) {
  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

async function patchStored(patch: (s: StoredDrive) => StoredDrive) {
  const cur = await readStored();
  if (cur) await writeStored(patch(cur));
}

export type DriveStatus = { configured: boolean; connected: boolean; needsReconnect: boolean; email: string | null; connectedAt: string | null };

export async function driveStatus(): Promise<DriveStatus> {
  const stored = await readStored();
  return {
    configured: googleKeys() !== null,
    connected: stored !== null,
    needsReconnect: stored?.needsReconnect === true,
    email: stored?.email ?? null,
    connectedAt: stored?.connectedAt || null,
  };
}

/* ------------------------------ OAuth state ------------------------------ */

/** Ξεχωριστό κλειδί από του session: ένα state δεν μπορεί ποτέ να περάσει για cookie σύνδεσης (και αντίστροφα). */
function stateKey(): Uint8Array {
  return new TextEncoder().encode(`google-oauth-state:${process.env.NIDO_SECRET ?? "nido-village-dev-secret-change-me"}`);
}

function randomToken(bytes = 24): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Υπογεγραμμένο state (HS256, λήγει σε 10'), δεμένο με τον διαχειριστή που ξεκίνησε τη σύνδεση και το redirect URI. */
export async function createOAuthState(userId: number, redirectUri: string): Promise<string> {
  return new SignJWT({ uid: userId, r: redirectUri, n: randomToken() })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("google-oauth")
    .setIssuedAt()
    .setExpirationTime(`${GOOGLE_STATE_MINUTES}m`)
    .sign(stateKey());
}

/** Το state της Google πρέπει να είναι ΙΔΙΟ με του cookie, γνήσιο, σε ισχύ και του ίδιου χρήστη. */
export async function verifyOAuthState(input: { state: string | null | undefined; cookie: string | null | undefined; userId: number }): Promise<{ redirectUri: string }> {
  const { state, cookie, userId } = input;
  if (!state || !cookie || !sameString(state, cookie)) throw new DriveError("state", MSG.state, "state");
  try {
    const { payload } = await jwtVerify(state, stateKey(), { audience: "google-oauth", algorithms: ["HS256"] });
    if (payload.uid !== userId || typeof payload.r !== "string") throw new Error("mismatch");
    return { redirectUri: payload.r };
  } catch {
    throw new DriveError("state", MSG.state, "state");
  }
}

export function buildGoogleAuthUrl(input: { redirectUri: string; state: string }): string {
  const { clientId } = requireKeys();
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    // offline + consent: η Google δίνει refresh token κάθε φορά (αλλιώς μόνο στην πρώτη συγκατάθεση).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
  }).toString();
  return u.toString();
}

/* ------------------------------ Αιτήματα ------------------------------ */

type FetchInit = { method?: string; headers?: Record<string, string>; body?: BodyInit };

/** fetch με χρονικό όριο· σφάλματα δικτύου γίνονται καθαρό μήνυμα. */
async function gfetch(url: string, init: FetchInit = {}, timeoutMs = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    throw new DriveError("network", MSG.network, "network");
  } finally {
    clearTimeout(timer);
  }
}

async function json(res: Response): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await res.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Access token στη μνήμη του στιγμιότυπου (ποτέ στη βάση). */
let cached: { for: string; token: string; expiresAt: number } | null = null;

/** Μόνο για tests. */
export function resetDriveCache() {
  cached = null;
}

async function requestToken(params: Record<string, string>): Promise<{ res: Response; body: Record<string, unknown> }> {
  const { clientId, clientSecret } = requireKeys();
  const res = await gfetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
  });
  return { res, body: await json(res) };
}

function tokenFailure(res: Response, body: Record<string, unknown>): DriveError {
  if (body.error === "invalid_client" || body.error === "unauthorized_client") return new DriveError("not_configured", MSG.badKeys, "keys");
  return new DriveError("api", `Η Google δεν έδωσε πρόσβαση (σφάλμα ${res.status}). Δοκίμασε ξανά σε λίγο.`);
}

async function accessToken(stored: StoredDrive, force = false): Promise<string> {
  if (!force && cached && cached.for === stored.refreshTokenEnc && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const refreshToken = decryptPin(stored.refreshTokenEnc);
  if (!refreshToken) throw new DriveError("reconnect", MSG.unreadable);
  const { res, body } = await requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (!res.ok || typeof body.access_token !== "string") {
    cached = null;
    if (body.error === "invalid_grant") {
      // Ανακλήθηκε από τον χρήστη, άλλαξε κωδικός, ή έληξε (εφαρμογή σε «Testing»: 7 ημέρες).
      await patchStored((s) => ({ ...s, needsReconnect: true }));
      throw new DriveError("reconnect", MSG.reconnect);
    }
    throw tokenFailure(res, body);
  }
  const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600;
  cached = { for: stored.refreshTokenEnc, token: body.access_token, expiresAt: Date.now() + ttl * 1000 };
  return cached.token;
}

async function requireStored(): Promise<StoredDrive> {
  requireKeys();
  const stored = await readStored();
  if (!stored) throw new DriveError("not_connected", MSG.notConnected);
  return stored;
}

/** Αίτημα στο Drive API. Σε 401 ανανεώνει το access token και ξαναδοκιμάζει ΜΙΑ φορά. */
async function driveFetch(stored: StoredDrive, url: string, init: FetchInit = {}, timeoutMs?: number): Promise<Response> {
  const call = async (token: string) => gfetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } }, timeoutMs);
  let res = await call(await accessToken(stored));
  if (res.status === 401) {
    res = await call(await accessToken(stored, true));
    if (res.status === 401) {
      cached = null;
      await patchStored((s) => ({ ...s, needsReconnect: true }));
      throw new DriveError("reconnect", MSG.reconnect);
    }
  }
  return res;
}

/** Μετατρέπει απάντηση σφάλματος του Drive σε μήνυμα για τον χρήστη. */
async function driveFailure(res: Response, what: string): Promise<DriveError> {
  const body = await json(res);
  const err = (body.error && typeof body.error === "object" ? body.error : {}) as { errors?: { reason?: string }[]; status?: string };
  const reason = err.errors?.[0]?.reason ?? err.status ?? "";
  if (res.status === 403 && /storageQuotaExceeded|teamDriveFileLimitExceeded/.test(reason)) return new DriveError("quota", MSG.quota);
  if (res.status === 429 || /rateLimitExceeded/i.test(reason)) return new DriveError("api", MSG.rate);
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(reason)) return new DriveError("not_configured", MSG.apiOff, "apioff");
  if (res.status === 403) return new DriveError("api", `Το Google Drive αρνήθηκε την ενέργεια (${what}). Αν επιμένει, αποσύνδεσε και σύνδεσε ξανά το Drive.`);
  if (res.status >= 500) return new DriveError("api", `Το Google Drive δεν απάντησε σωστά (σφάλμα ${res.status}) — ${what}. Δοκίμασε ξανά σε λίγο.`);
  return new DriveError("api", `Το Google Drive απέρριψε το αίτημα (σφάλμα ${res.status}) — ${what}.`);
}

/* ------------------------------ Σύνδεση ------------------------------ */

/** Ανταλλάσσει τον κωδικό της Google με tokens και αποθηκεύει ΚΡΥΠΤΟΓΡΑΦΗΜΕΝΟ το refresh token. */
export async function connectDrive(input: { code: string; redirectUri: string }, employeeId: number): Promise<{ email: string | null }> {
  const { res, body } = await requestToken({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri });
  if (!res.ok || typeof body.access_token !== "string") {
    if (body.error === "invalid_grant") throw new DriveError("state", MSG.state, "state");
    if (body.error === "redirect_uri_mismatch") {
      throw new DriveError("not_configured", `Το redirect URI δεν ταιριάζει. Στο Google Cloud βάλε ακριβώς: ${input.redirectUri}`, "redirect");
    }
    throw tokenFailure(res, body);
  }
  if (typeof body.scope === "string" && !body.scope.split(/\s+/).includes(DRIVE_SCOPE)) throw new DriveError("denied", MSG.noScope, "noscope");
  if (typeof body.refresh_token !== "string" || !body.refresh_token) throw new DriveError("api", MSG.noRefresh, "norefresh");

  // Ποιος λογαριασμός συνδέθηκε (για να φαίνεται στις Ρυθμίσεις). Αν αποτύχει, η σύνδεση ισχύει κανονικά.
  let email: string | null = null;
  try {
    const about = await gfetch(`${API}/about?fields=${encodeURIComponent("user(emailAddress)")}`, { headers: { authorization: `Bearer ${body.access_token}` } });
    if (about.ok) {
      const u = (await json(about)).user as { emailAddress?: unknown } | undefined;
      if (typeof u?.emailAddress === "string") email = u.emailAddress;
    }
  } catch {
    /* χωρίς email */
  }
  const refreshTokenEnc = encryptPin(body.refresh_token);
  await writeStored({ refreshTokenEnc, email, connectedAt: new Date().toISOString(), folders: {} });
  const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600;
  cached = { for: refreshTokenEnc, token: body.access_token, expiresAt: Date.now() + ttl * 1000 };
  await audit(await getDb(), employeeId, "drive_connect", "settings", null, { email });
  return { email };
}

/** Αποσύνδεση: ανακαλεί την άδεια στη Google (όσο γίνεται) και σβήνει ό,τι είχε αποθηκευτεί. Τα αρχεία μένουν στο Drive. */
export async function disconnectDrive(employeeId: number) {
  const db = await getDb();
  const stored = await readStored();
  if (stored) {
    const refreshToken = decryptPin(stored.refreshTokenEnc);
    if (refreshToken) {
      try {
        await gfetch(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }).toString() }, 10000);
      } catch {
        /* η τοπική αποσύνδεση γίνεται ούτως ή άλλως */
      }
    }
  }
  await db.delete(schema.settings).where(eq(schema.settings.key, SETTINGS_KEY));
  cached = null;
  await audit(db, employeeId, "drive_disconnect", "settings", null, { email: stored?.email ?? null });
}

/* ------------------------------ Φάκελοι ------------------------------ */

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findFolder(stored: StoredDrive, name: string, parentId: string): Promise<string | null> {
  const query = `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and '${q(parentId)}' in parents and trashed = false`;
  const url = `${API}/files?${new URLSearchParams({ q: query, fields: "files(id,name)", spaces: "drive", pageSize: "1" })}`;
  const res = await driveFetch(stored, url);
  if (!res.ok) throw await driveFailure(res, "αναζήτηση φακέλου");
  const files = (await json(res)).files as { id?: unknown }[] | undefined;
  const id = files?.[0]?.id;
  return typeof id === "string" ? id : null;
}

async function createFolder(stored: StoredDrive, name: string, parentId: string): Promise<string> {
  const res = await driveFetch(stored, `${API}/files?fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw await driveFailure(res, "δημιουργία φακέλου");
  const id = (await json(res)).id;
  if (typeof id !== "string") throw new DriveError("api", "Το Google Drive δεν επέστρεψε τον νέο φάκελο. Δοκίμασε ξανά.");
  return id;
}

/** Ο φάκελος υπάρχει ακόμη και δεν είναι στον κάδο; */
async function folderAlive(stored: StoredDrive, id: string): Promise<boolean> {
  const res = await driveFetch(stored, `${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent("id,trashed")}`);
  if (res.status === 404) return false;
  if (!res.ok) throw await driveFailure(res, "έλεγχος φακέλου");
  return (await json(res)).trashed !== true;
}

/**
 * Επιστρέφει το id του φακέλου για τη διαδρομή (π.χ. ["Nido Τιμολόγια","2026","11"]), δημιουργώντας ό,τι λείπει.
 * Τα id κρατιούνται στις ρυθμίσεις· αν κάποιος έσβησε φάκελο στο Drive (ή τον έστειλε στον κάδο), ξαναφτιάχνεται.
 */
async function ensureFolder(stored: StoredDrive, parts: string[]): Promise<string> {
  const forget = async () => {
    stored.folders = {};
    await patchStored((s) => ({ ...s, folders: {} }));
  };
  const leaf = stored.folders[parts.join("/")];
  if (leaf) {
    if (await folderAlive(stored, leaf)) return leaf;
    await forget();
  }
  for (let attempt = 0; ; attempt++) {
    let parent = "root";
    let key = "";
    let stale = false;
    const found: Record<string, string> = {};
    for (const name of parts) {
      key = key ? `${key}/${name}` : name;
      const known = stored.folders[key];
      if (known && !(await folderAlive(stored, known))) {
        stale = true;
        break;
      }
      const id = known ?? (await findFolder(stored, name, parent)) ?? (await createFolder(stored, name, parent));
      found[key] = id;
      parent = id;
    }
    if (stale && attempt === 0) {
      await forget();
      continue;
    }
    if (stale) throw new DriveError("api", "Οι φάκελοι στο Google Drive άλλαξαν την ώρα του ανεβάσματος. Δοκίμασε ξανά.");
    stored.folders = { ...stored.folders, ...found };
    await patchStored((s) => ({ ...s, folders: { ...s.folders, ...found } }));
    return parent;
  }
}

/* ------------------------------ Ανέβασμα ------------------------------ */

/** Σώμα multipart/related: πρώτα τα μεταδεδομένα (JSON), μετά τα bytes του αρχείου. */
export function buildMultipartBody(metadata: Record<string, unknown>, bytes: Uint8Array, mimeType: string, boundary: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
}

export type DriveFile = { fileId: string; url: string; name: string };

async function uploadFile(stored: StoredDrive, input: { name: string; mimeType: string; bytes: Uint8Array; folderId: string }): Promise<DriveFile> {
  const boundary = `nido-${randomToken(12)}`;
  const body = buildMultipartBody({ name: input.name, parents: [input.folderId] }, input.bytes, input.mimeType, boundary);
  const url = `${UPLOAD_URL}?${new URLSearchParams({ uploadType: "multipart", fields: "id,name,webViewLink" })}`;
  const res = await driveFetch(stored, url, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body }, 90000);
  if (!res.ok) throw await driveFailure(res, "ανέβασμα αρχείου");
  const f = await json(res);
  if (typeof f.id !== "string") throw new DriveError("api", "Το Google Drive δεν επιβεβαίωσε το ανέβασμα. Δοκίμασε ξανά.");
  return {
    fileId: f.id,
    name: typeof f.name === "string" ? f.name : input.name,
    url: typeof f.webViewLink === "string" ? f.webViewLink : `https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view`,
  };
}

/** Ανεβάζει παραστατικό στο "Nido Τιμολόγια/<ΕΤΟΣ>/<ΜΗΝΑΣ>" με όνομα "<ημ/νία> <προμηθευτής> <αριθμός>.<ext>". */
export async function uploadInvoiceToDrive(input: { bytes: Uint8Array; kind: InvoiceFileKind; date: string; supplier?: string | null; docNumber?: string | null }): Promise<DriveFile> {
  const stored = await requireStored();
  const folderId = await ensureFolder(stored, invoiceFolderPath(input.date));
  const name = invoiceFileName({ date: input.date, supplier: input.supplier, docNumber: input.docNumber, ext: input.kind });
  const file = await uploadFile(stored, { name, mimeType: INVOICE_MIME[input.kind], bytes: input.bytes, folderId });
  if (stored.needsReconnect) await patchStored((s) => ({ ...s, needsReconnect: false }));
  return file;
}

/** «Δοκιμαστικό ανέβασμα» από τις Ρυθμίσεις: μικρό αρχείο κειμένου στον βασικό φάκελο. */
export async function testDriveUpload(now = new Date()): Promise<DriveFile> {
  const stored = await requireStored();
  const folderId = await ensureFolder(stored, [DRIVE_ROOT_FOLDER]);
  const stamp = now.toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const bytes = new TextEncoder().encode(`Δοκιμή σύνδεσης Nido Village PDA με το Google Drive.\r\n${now.toISOString()}\r\nΜπορείς να σβήσεις αυτό το αρχείο.\r\n`);
  const file = await uploadFile(stored, { name: `Δοκιμή σύνδεσης ${stamp}.txt`, mimeType: "text/plain; charset=UTF-8", bytes, folderId });
  if (stored.needsReconnect) await patchStored((s) => ({ ...s, needsReconnect: false }));
  return file;
}

/** Στέλνει αρχείο στον κάδο του Drive (ανακτήσιμο για 30 ημέρες). "missing" αν έχει ήδη σβηστεί. */
export async function trashDriveFile(fileId: string): Promise<"trashed" | "missing"> {
  const stored = await requireStored();
  const res = await driveFetch(stored, `${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: "PATCH",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ trashed: true }),
  });
  if (res.status === 404) return "missing";
  if (!res.ok) throw await driveFailure(res, "μεταφορά στον κάδο");
  return "trashed";
}
