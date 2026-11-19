export function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Σφάλμα «μοναδικότητας» της Postgres (23505), όπως το πετούν ο pg, το PGlite ή το drizzle (με cause). */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  let cur: unknown = e;
  for (let i = 0; cur && i < 5; i++) {
    const c = cur as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (c.code === "23505") return !constraint || c.constraint === constraint || String(c.message ?? "").includes(constraint);
    cur = c.cause;
  }
  return false;
}
