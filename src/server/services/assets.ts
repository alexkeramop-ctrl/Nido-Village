/** Αποθήκευση εικόνων (χάρτης χώρου) στη βάση ως base64, σερβίρισμα από /api/assets/[id]. */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);

export async function saveAsset(input: { kind?: string; mime: string; bytes: Buffer; width?: number | null; height?: number | null }) {
  if (!ALLOWED.has(input.mime)) throw new Error("Επιτρέπονται μόνο εικόνες JPEG, PNG, WebP ή SVG");
  if (input.bytes.length > MAX_BYTES) throw new Error("Η εικόνα πρέπει να είναι έως 3MB");
  const db = await getDb();
  const [row] = await db
    .insert(schema.assets)
    .values({ kind: input.kind ?? "map", mime: input.mime, data: input.bytes.toString("base64"), width: input.width ?? null, height: input.height ?? null })
    .returning({ id: schema.assets.id, mime: schema.assets.mime, width: schema.assets.width, height: schema.assets.height, createdAt: schema.assets.createdAt });
  return row;
}

export async function getAsset(id: number) {
  const db = await getDb();
  const row = await db.query.assets.findFirst({ where: eq(schema.assets.id, id) });
  if (!row) return null;
  return { id: row.id, mime: row.mime, bytes: Buffer.from(row.data, "base64"), width: row.width, height: row.height, createdAt: row.createdAt };
}

export async function getAssetMeta(id: number) {
  const db = await getDb();
  return db.query.assets.findFirst({
    where: eq(schema.assets.id, id),
    columns: { id: true, mime: true, width: true, height: true, createdAt: true },
  });
}
