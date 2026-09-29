import { getAsset } from "@/server/services/assets";

export const dynamic = "force-dynamic";

/** Σερβίρει εικόνες (χάρτης χώρου) από τη βάση με cache. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return new Response("not found", { status: 404 });
  const a = await getAsset(n);
  if (!a) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(a.bytes), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(a.bytes.length),
      "Cache-Control": "public, max-age=86400, immutable",
      ETag: `"asset-${a.id}-${a.createdAt.getTime()}"`,
    },
  });
}
