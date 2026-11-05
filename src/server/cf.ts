/**
 * Cloudflare Workers (μέσω OpenNext). Στα Workers δεν υπάρχει δίσκος ούτε διεργασίες στο παρασκήνιο,
 * και οι συνδέσεις (sockets) ζουν μόνο μέσα στο αίτημα που τις άνοιξε.
 */
export const isWorker = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

type CfEnv = {
  HYPERDRIVE?: { connectionString: string };
  ASSETS?: { fetch: (input: Request | string) => Promise<Response> };
  [k: string]: unknown;
};
type CfCtx = { waitUntil(p: Promise<unknown>): void };

export async function cfContext(): Promise<{ env: CfEnv; ctx: CfCtx }> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const c = await getCloudflareContext({ async: true });
  return { env: c.env as unknown as CfEnv, ctx: c.ctx as unknown as CfCtx };
}

/** Τρέχει εργασία μετά την απάντηση (Workers: ctx.waitUntil). Εκτός Workers δεν κάνει τίποτα. */
export function runAfterResponse(task: () => Promise<unknown>) {
  if (!isWorker) return;
  cfContext()
    .then(({ ctx }) => ctx.waitUntil(task().catch((e) => console.error("[nido] background task:", e))))
    .catch(() => {});
}
