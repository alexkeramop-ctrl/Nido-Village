/** Stub για το build του Cloudflare: εκεί η βάση είναι πάντα Postgres (Hyperdrive / DATABASE_URL). */
export async function connectPglite(): Promise<never> {
  throw new Error("[nido] Στο Cloudflare χρειάζεται βάση Postgres: ορίστε HYPERDRIVE ή DATABASE_URL.");
}
