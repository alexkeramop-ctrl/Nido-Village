import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded } from "./helpers";
import { OPTIONS, POST } from "@/app/api/public/booking-request/route";
import { BOOKING_REQUESTS_PER_HOUR, handleBookingRequest, hashIp, takeRateLimitSlot, validateBookingRequest } from "@/server/services/booking-requests";
import { bookingsDueSummary } from "@/server/services/booking-payments";
import { pendingWebsiteRequests } from "@/server/services/events";
import { addDays, todayAthens } from "@/server/services/reports";

const today = todayAthens();
const valid = () => ({
  type: "party",
  date: addDays(today, 21),
  name: "Δήμητρα Αλεξίου",
  phone: "+30 697 123 4567",
  email: "dimitra@example.com",
  kids: 14,
  adults: 10,
  message: "Θα θέλαμε το πακέτο με το φουσκωτό.",
  consent: true,
  website: "",
});

async function countEvents() {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.events);
  return r.n;
}

beforeAll(async () => {
  await seeded();
});

describe("αίτημα κράτησης από το site: έλεγχος", () => {
  it("δέχεται σωστό αίτημα και κανονικοποιεί τα πεδία", () => {
    const v = validateBookingRequest({ ...valid(), name: "  Δήμητρα   Αλεξίου ", email: " Dimitra@Example.com ", kids: "14", unknownField: "αγνοείται" }, today);
    expect(v).toEqual({
      ok: true,
      data: { type: "party", date: addDays(today, 21), name: "Δήμητρα Αλεξίου", phone: "6971234567", email: "dimitra@example.com", kids: 14, adults: 10, message: "Θα θέλαμε το πακέτο με το φουσκωτό.", consent: true },
    });
    // Προαιρετικά πεδία.
    const min = validateBookingRequest({ type: "wedding", date: addDays(today, 200), name: "Άννα Β", phone: "2310123456" }, today);
    expect(min).toMatchObject({ ok: true, data: { email: null, kids: 0, adults: 0, message: null, consent: false } });
    expect(validateBookingRequest({ ...valid(), date: today }, today).ok).toBe(true);
  });

  it("απορρίπτει λάθος πεδία με μήνυμα ανά πεδίο", () => {
    const fields = (patch: Record<string, unknown>) => {
      const v = validateBookingRequest({ ...valid(), ...patch }, today);
      return v.ok ? [] : Object.keys(v.errors);
    };
    expect(fields({ type: "corporate" })).toEqual(["type"]);
    expect(fields({ type: undefined })).toEqual(["type"]);
    expect(fields({ date: addDays(today, -1) })).toEqual(["date"]);
    expect(fields({ date: "2027-02-30" })).toEqual(["date"]);
    expect(fields({ date: "21/12/2026" })).toEqual(["date"]);
    expect(fields({ date: addDays(today, 800) })).toEqual(["date"]);
    expect(fields({ name: "Α" })).toEqual(["name"]);
    expect(fields({ name: "x".repeat(81) })).toEqual(["name"]);
    expect(fields({ name: "12345" })).toEqual(["name"]);
    expect(fields({ name: "Δες το https://spam.example" })).toEqual(["name"]);
    expect(fields({ name: "<script>alert(1)</script>" })).toEqual(["name"]);
    expect(fields({ name: 42 })).toEqual(["name"]);
    expect(fields({ phone: "12345" })).toEqual(["phone"]);
    expect(fields({ phone: "" })).toEqual(["phone"]);
    expect(fields({ phone: undefined })).toEqual(["phone"]);
    expect(fields({ email: "όχι-email" })).toEqual(["email"]);
    expect(fields({ email: 5 })).toEqual(["email"]);
    expect(fields({ kids: -1 })).toEqual(["kids"]);
    expect(fields({ kids: 2.5 })).toEqual(["kids"]);
    expect(fields({ kids: "πολλά" })).toEqual(["kids"]);
    expect(fields({ kids: 501 })).toEqual(["kids"]);
    expect(fields({ adults: true })).toEqual(["adults"]);
    expect(fields({ message: "μ".repeat(1001) })).toEqual(["message"]);
    expect(fields({ message: { a: 1 } })).toEqual(["message"]);
    expect(fields({ consent: "yes" })).toEqual(["consent"]);
    expect(fields({ type: "x", phone: "1", name: "" }).sort()).toEqual(["name", "phone", "type"]);
    for (const bad of [null, undefined, "κείμενο", 7, []]) expect(validateBookingRequest(bad, today)).toMatchObject({ ok: false, errors: { body: expect.any(String) } });
  });
});

describe("αίτημα κράτησης από το site: ροή", () => {
  it("δημιουργεί κράτηση «Αίτημα» από site μαζί με τον πελάτη και τη συγκατάθεσή του", async () => {
    const before = await countEvents();
    const out = await handleBookingRequest(valid(), "203.0.113.10");
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(await countEvents()).toBe(before + 1);

    const [ev] = await pendingWebsiteRequests();
    expect(ev).toMatchObject({
      title: "Αίτημα από site: Δήμητρα Αλεξίου",
      type: "party",
      status: "inquiry",
      source: "website",
      date: addDays(today, 21),
      startTime: "11:00",
      endTime: "13:30",
      guests: 24,
      customerName: "Δήμητρα Αλεξίου",
      customerPhone: "6971234567",
      customerEmail: "dimitra@example.com",
      priceCents: 0,
      createdBy: null,
    });
    expect(ev.party).toMatchObject({ kids: 14, adults: 10 });
    expect(ev.notes).toContain("Θα θέλαμε το πακέτο με το φουσκωτό.");
    expect(ev.notes).toContain("Συγκατάθεση για ενημερώσεις: ναι");

    const db = await getDb();
    const customer = (await db.query.customers.findFirst({ where: eq(schema.customers.id, ev.customerId!) }))!;
    expect(customer).toMatchObject({ name: "Δήμητρα Αλεξίου", phone: "6971234567", email: "dimitra@example.com", marketingConsent: true });
    expect(customer.consentAt).toBeInstanceOf(Date);
    expect((await bookingsDueSummary()).websiteRequests).toBe(1);

    // Δεύτερο αίτημα του ίδιου πελάτη χωρίς τσεκ συγκατάθεσης: ίδιος πελάτης, η συγκατάθεση ΔΕΝ ανακαλείται.
    await handleBookingRequest({ ...valid(), type: "christening", date: addDays(today, 90), consent: false, kids: undefined, adults: 80 }, "203.0.113.10");
    const reqs = await pendingWebsiteRequests();
    expect(reqs).toHaveLength(2);
    expect(reqs[1]).toMatchObject({ type: "christening", endTime: "23:59", guests: 80, customerId: ev.customerId, party: null });
    expect((await db.query.customers.findFirst({ where: eq(schema.customers.id, ev.customerId!) }))!.marketingConsent).toBe(true);
    // Το αίτημα γράφεται στο ιστορικό χωρίς υπάλληλο.
    const log = await db.query.auditLog.findMany({ where: eq(schema.auditLog.action, "booking_request") });
    expect(log).toHaveLength(2);
    expect(log[0].employeeId).toBeNull();
  });

  it("παγίδα bots: συμπληρωμένο «website» απαντά ok χωρίς να δημιουργεί τίποτα", async () => {
    const db = await getDb();
    const before = await countEvents();
    const hitsBefore = (await db.select().from(schema.bookingRequestHits)).length;
    expect(await handleBookingRequest({ ...valid(), website: "https://spam.example" }, "198.51.100.1")).toEqual({ status: 200, body: { ok: true } });
    // Ακόμη και με άκυρα υπόλοιπα πεδία, το bot δεν μαθαίνει τίποτα.
    expect(await handleBookingRequest({ website: "x", name: "" }, "198.51.100.1")).toEqual({ status: 200, body: { ok: true } });
    expect(await countEvents()).toBe(before);
    expect((await db.select().from(schema.bookingRequestHits)).length).toBe(hitsBefore);
  });

  it("άκυρο αίτημα: 400 με τα πεδία, χωρίς κράτηση και χωρίς να μετράει στο όριο", async () => {
    const db = await getDb();
    const before = await countEvents();
    const hitsBefore = (await db.select().from(schema.bookingRequestHits)).length;
    const out = await handleBookingRequest({ ...valid(), phone: "123", date: "χθες" }, "198.51.100.2");
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ ok: false, error: "invalid", fields: { phone: expect.any(String), date: expect.any(String) } });
    expect(await countEvents()).toBe(before);
    expect((await db.select().from(schema.bookingRequestHits)).length).toBe(hitsBefore);
  });

  it("όριο ανά IP: έως 5 αιτήματα την ώρα, το 6ο παίρνει 429", async () => {
    const ip = "192.0.2.77";
    const before = await countEvents();
    for (let i = 0; i < BOOKING_REQUESTS_PER_HOUR; i++) {
      const out = await handleBookingRequest({ ...valid(), name: `Πελάτης ${"ΑΒΓΔΕ"[i]}`, phone: `697000000${i}` }, ip);
      expect(out.status).toBe(200);
    }
    const blocked = await handleBookingRequest({ ...valid(), phone: "6970000009" }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ ok: false, error: "rate_limited" });
    expect(await countEvents()).toBe(before + BOOKING_REQUESTS_PER_HOUR);
    // Άλλη IP δεν επηρεάζεται.
    expect((await handleBookingRequest({ ...valid(), phone: "6970000010" }, "192.0.2.78")).status).toBe(200);

    // Η IP δεν αποθηκεύεται ποτέ: μόνο το hash της.
    const db = await getDb();
    const hits = await db.select().from(schema.bookingRequestHits);
    expect(hits.every((h) => /^[0-9a-f]{64}$/.test(h.ipHash))).toBe(true);
    expect(hits.some((h) => h.ipHash.includes("192.0.2"))).toBe(false);
    expect(await hashIp(ip)).toBe(await hashIp(` ${ip} `));
    expect(await hashIp(ip)).not.toBe(await hashIp("192.0.2.78"));
  });

  it("το όριο μετράει μόνο την τελευταία ώρα και καθαρίζει τις παλιές εγγραφές", async () => {
    const db = await getDb();
    const h = await hashIp("192.0.2.200");
    const now = new Date(Date.now() + 5 * 86400_000);
    const old = new Date(now.getTime() - 61 * 60_000);
    const ancient = new Date(now.getTime() - 25 * 3600_000);
    await db.insert(schema.bookingRequestHits).values([...Array.from({ length: 5 }, () => ({ ipHash: h, createdAt: old })), { ipHash: h, createdAt: ancient }]);
    for (let i = 0; i < BOOKING_REQUESTS_PER_HOUR; i++) expect(await takeRateLimitSlot(h, now)).toBe(true);
    expect(await takeRateLimitSlot(h, now)).toBe(false);
    // Μία ώρα μετά ξανανοίγει.
    expect(await takeRateLimitSlot(h, new Date(now.getTime() + 3601_000))).toBe(true);
    const mine = (await db.select().from(schema.bookingRequestHits)).filter((x) => x.ipHash === h);
    expect(mine.some((x) => x.createdAt.getTime() === ancient.getTime())).toBe(false);
  });
});

describe("POST /api/public/booking-request", () => {
  const url = "https://pda.example/api/public/booking-request";
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    POST(new Request(url, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.50", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("δέχεται αιτήματα από το nidovillage.gr με τις κεφαλίδες CORS", async () => {
    for (const origin of ["https://nidovillage.gr", "https://www.nidovillage.gr"]) {
      const res = await post({ ...valid(), phone: origin.includes("www") ? "6975550001" : "6975550002" }, { origin });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("vary")).toBe("Origin");
    }
    const pre = await OPTIONS(new Request(url, { method: "OPTIONS", headers: { origin: "https://www.nidovillage.gr", "access-control-request-method": "POST" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://www.nidovillage.gr");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect(pre.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });

  it("αρνείται άλλα origins, άκυρο JSON και πολύ μεγάλο σώμα", async () => {
    const before = await countEvents();
    const evil = await post(valid(), { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const preEvil = await OPTIONS(new Request(url, { method: "OPTIONS", headers: { origin: "https://nidovillage.gr.evil.example" } }));
    expect(preEvil.headers.get("access-control-allow-origin")).toBeNull();

    const badJson = await post("{όχι json", { origin: "https://nidovillage.gr" });
    expect(badJson.status).toBe(400);
    expect(badJson.headers.get("access-control-allow-origin")).toBe("https://nidovillage.gr");

    const invalid = await post({ ...valid(), phone: "x" }, { origin: "https://nidovillage.gr" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).fields.phone).toBeTruthy();

    const huge = await post({ ...valid(), message: "α".repeat(20000) }, { origin: "https://nidovillage.gr" });
    expect(huge.status).toBe(413);
    expect(await countEvents()).toBe(before);

    // Χωρίς Origin (server σε server) το αίτημα περνά, χωρίς κεφαλίδα CORS.
    const s2s = await post({ ...valid(), phone: "6975550003" });
    expect(s2s.status).toBe(200);
    expect(s2s.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("το όριο ανά IP ισχύει και στο endpoint (429 με Retry-After)", async () => {
    const headers = { origin: "https://nidovillage.gr", "cf-connecting-ip": "198.51.100.99" };
    for (let i = 0; i < BOOKING_REQUESTS_PER_HOUR; i++) expect((await post({ ...valid(), phone: `698111000${i}` }, headers)).status).toBe(200);
    const res = await post({ ...valid(), phone: "6981110009" }, headers);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://nidovillage.gr");
  });
});
