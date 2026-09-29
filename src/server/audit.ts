import { schema } from "@/db";
import type { Db } from "@/db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbLike = Db | Tx;

export async function audit(
  db: DbLike,
  employeeId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  details?: Record<string, unknown>,
) {
  await db.insert(schema.auditLog).values({ employeeId, action, entity, entityId, details: details ?? null });
}
