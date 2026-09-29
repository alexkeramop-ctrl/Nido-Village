/** Τρέχει μία φορά στην εκκίνηση του server: seed, worker εκτύπωσης, cloud publisher. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("@/db");
  const { seedDemo } = await import("@/db/seed");
  const { startPrintWorker } = await import("@/server/printing/queue");
  const { startCloudPublisher } = await import("@/server/cloud/publisher");
  const { bootstrapPartnerFromEnv } = await import("@/server/services/partners");
  const cloud = process.env.NIDO_MODE === "cloud";
  const db = await getDb();
  const seedFlag = process.env.NIDO_SEED_DEMO;
  const shouldSeed = cloud ? seedFlag === "1" : seedFlag !== "0";
  if (shouldSeed) {
    // Κλείδωμα ώστε δύο στιγμιότυπα (serverless) να μη φορτώσουν το demo δύο φορές.
    const { sql } = await import("drizzle-orm");
    const did = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(20260929)`);
      return seedDemo(tx as unknown as typeof db);
    });
    if (did) console.log("[nido] Φορτώθηκαν δεδομένα επίδειξης (PIN διαχειριστή: 1234)");
  }
  await bootstrapPartnerFromEnv();
  if (!cloud) startPrintWorker();
  startCloudPublisher();
}
