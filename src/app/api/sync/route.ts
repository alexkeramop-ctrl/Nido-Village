import { timingSafeEqual } from "node:crypto";
import { storeSnapshot, type Snapshot } from "@/server/cloud/snapshot";

export const dynamic = "force-dynamic";

function keyOk(given: string | null): boolean {
  const expected = process.env.CLOUD_SYNC_KEY;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Δέχεται snapshot στατιστικών από το κατάστημα (κλειδί στο header x-nido-sync-key). */
export async function POST(req: Request) {
  if (!keyOk(req.headers.get("x-nido-sync-key"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Snapshot;
  try {
    body = (await req.json()) as Snapshot;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || body.version !== 1 || !body.computedAt || !body.today?.range?.from) {
    return Response.json({ error: "invalid snapshot" }, { status: 400 });
  }
  await storeSnapshot(body);
  return Response.json({ ok: true, receivedAt: new Date().toISOString() });
}
