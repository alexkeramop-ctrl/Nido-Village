import { beforeAll, describe, expect, it } from "vitest";
import { seeded } from "./helpers";
import { computeSnapshot, getLatestSnapshot } from "@/server/cloud/snapshot";
import { POST } from "@/app/api/sync/route";

beforeAll(async () => {
  await seeded();
  process.env.CLOUD_SYNC_KEY = "k-secret";
});

describe("POST /api/sync", () => {
  it("rejects missing or wrong key", async () => {
    const r1 = await POST(new Request("http://x/api/sync", { method: "POST", body: "{}" }));
    expect(r1.status).toBe(401);
    const r2 = await POST(new Request("http://x/api/sync", { method: "POST", body: "{}", headers: { "x-nido-sync-key": "nope" } }));
    expect(r2.status).toBe(401);
  });

  it("rejects invalid payloads and stores valid snapshots", async () => {
    const bad = await POST(new Request("http://x/api/sync", { method: "POST", body: JSON.stringify({ version: 2 }), headers: { "x-nido-sync-key": "k-secret" } }));
    expect(bad.status).toBe(400);
    const snap = await computeSnapshot();
    const ok = await POST(new Request("http://x/api/sync", { method: "POST", body: JSON.stringify(snap), headers: { "x-nido-sync-key": "k-secret", "content-type": "application/json" } }));
    expect(ok.status).toBe(200);
    const latest = await getLatestSnapshot();
    expect(latest?.snapshot.computedAt).toBe(snap.computedAt);
  });
});
