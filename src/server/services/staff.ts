import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { omit } from "@/server/util";
import { hashPin } from "@/server/pin";
import type { EmployeeRole } from "@/db/schema";

export const ROLE_LABEL: Record<EmployeeRole, string> = {
  admin: "Διαχειριστής",
  manager: "Υπεύθυνος",
  cashier: "Ταμίας",
  waiter: "Σερβιτόρος",
  kitchen: "Κουζίνα",
};

export async function listEmployees(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.employees.findMany({ orderBy: [asc(schema.employees.name)] });
  return rows.filter((e) => includeInactive || e.active).map((e) => omit(e, "pinHash"));
}

export async function upsertEmployee(input: { id?: number; name: string; role: EmployeeRole; pin?: string; active?: boolean }) {
  const db = await getDb();
  if (input.pin !== undefined && input.pin !== "" && !/^\d{4,8}$/.test(input.pin)) {
    throw new Error("Το PIN πρέπει να έχει 4 έως 8 ψηφία");
  }
  if (input.id) {
    const set: Partial<typeof schema.employees.$inferInsert> = { name: input.name, role: input.role };
    if (input.active !== undefined) set.active = input.active;
    if (input.pin) set.pinHash = hashPin(input.pin);
    const [row] = await db.update(schema.employees).set(set).where(eq(schema.employees.id, input.id)).returning();
    return row;
  }
  if (!input.pin) throw new Error("Απαιτείται PIN για νέο υπάλληλο");
  const [row] = await db
    .insert(schema.employees)
    .values({ name: input.name, role: input.role, pinHash: hashPin(input.pin), active: input.active ?? true })
    .returning();
  return row;
}
