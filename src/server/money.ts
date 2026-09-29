/** Βοηθητικά για χρήματα (λεπτά) και ποσότητες. */

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}${euros.toLocaleString("el-GR")},${rest.toString().padStart(2, "0")} €`;
}

/** "12,50" ή "12.50" -> 1250 */
export function parseEuroToCents(input: string | number): number {
  if (typeof input === "number") return Math.round(input * 100);
  const cleaned = input.replace(/\s|€/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Μη έγκυρο ποσό: ${input}`);
  return Math.round(n * 100);
}

/** Υπολογισμός ΦΠΑ που περιέχεται σε τελική τιμή (οι τιμές μενού περιλαμβάνουν ΦΠΑ). */
export function vatIncludedCents(grossCents: number, ratePct: number): number {
  if (ratePct <= 0) return 0;
  return Math.round(grossCents - grossCents / (1 + ratePct / 100));
}

export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** numeric(…,3) ως string για την Postgres. */
export function qty3(n: number): string {
  return (Math.round(n * 1000) / 1000).toFixed(3);
}

export function qty4(n: number): string {
  return (Math.round(n * 10000) / 10000).toFixed(4);
}
