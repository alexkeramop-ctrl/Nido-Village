import { asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { omit } from "@/server/util";
import { decryptPin, encryptPin, hashPin } from "@/server/pin";
import { audit } from "@/server/audit";
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
  const rows = await db.query.employees.findMany({ where: isNull(schema.employees.deletedAt), orderBy: [asc(schema.employees.name)] });
  return rows
    .filter((e) => !e.pinHash.startsWith("system:"))
    .filter((e) => includeInactive || e.active)
    .map((e) => ({ ...omit(e, "pinHash", "pinEncrypted"), hasPin: !!e.pinEncrypted }));
}

/** Πόσες εγγραφές αναφέρονται σε έναν υπάλληλο (παραγγελίες, συνεδρίες, πληρωμές, κινήσεις, ιστορικό). */
export async function employeeReferences(employeeId: number): Promise<number> {
  const db = await getDb();
  const res = (await db.execute(sql`
    select (
      (select count(*) from orders where employee_id = ${employeeId}) +
      (select count(*) from table_sessions where opened_by = ${employeeId} or closed_by = ${employeeId} or discount_by = ${employeeId}) +
      (select count(*) from payments where employee_id = ${employeeId}) +
      (select count(*) from stock_movements where employee_id = ${employeeId}) +
      (select count(*) from goods_receipts where employee_id = ${employeeId}) +
      (select count(*) from cash_sessions where opened_by = ${employeeId} or closed_by = ${employeeId}) +
      (select count(*) from order_items where voided_by = ${employeeId}) +
      (select count(*) from audit_log where employee_id = ${employeeId})
    )::int as n`)) as unknown as { rows: { n: number }[] };
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * Διαγραφή υπαλλήλου. Χωρίς ιστορικό: πλήρης διαγραφή. Με ιστορικό: απόκρυψη (deletedAt),
 * απενεργοποίηση και ακύρωση PIN, ώστε οι αναφορές να δείχνουν ακόμη το όνομά του.
 */
export async function deleteEmployee(employeeId: number, byEmployeeId: number): Promise<"deleted" | "archived"> {
  const db = await getDb();
  if (employeeId === byEmployeeId) throw new Error("Δεν μπορείς να διαγράψεις τον εαυτό σου");
  const e = await db.query.employees.findFirst({ where: eq(schema.employees.id, employeeId) });
  if (!e || e.deletedAt) throw new Error("Ο υπάλληλος δεν βρέθηκε");
  if (e.pinHash.startsWith("system:")) throw new Error("Ο χρήστης συστήματος δεν διαγράφεται");
  const refs = await employeeReferences(employeeId);
  if (refs === 0) {
    await db.delete(schema.employees).where(eq(schema.employees.id, employeeId));
    await audit(db, byEmployeeId, "employee_delete", "employee", employeeId, { name: e.name, mode: "hard" });
    return "deleted";
  }
  await db
    .update(schema.employees)
    .set({ deletedAt: new Date(), active: false, pinHash: `deleted:${e.pinHash}`, pinEncrypted: null })
    .where(eq(schema.employees.id, employeeId));
  await audit(db, byEmployeeId, "employee_delete", "employee", employeeId, { name: e.name, mode: "archived", references: refs });
  return "archived";
}

export async function upsertEmployee(input: { id?: number; name: string; role: EmployeeRole; pin?: string; active?: boolean }) {
  const db = await getDb();
  if (input.pin !== undefined && input.pin !== "" && !/^\d{4,8}$/.test(input.pin)) {
    throw new Error("Το PIN πρέπει να έχει 4 έως 8 ψηφία");
  }
  if (input.id) {
    const set: Partial<typeof schema.employees.$inferInsert> = { name: input.name, role: input.role };
    if (input.active !== undefined) set.active = input.active;
    if (input.pin) {
      set.pinHash = hashPin(input.pin);
      set.pinEncrypted = encryptPin(input.pin);
    }
    const [row] = await db.update(schema.employees).set(set).where(eq(schema.employees.id, input.id)).returning();
    return row;
  }
  if (!input.pin) throw new Error("Απαιτείται PIN για νέο υπάλληλο");
  const [row] = await db
    .insert(schema.employees)
    .values({ name: input.name, role: input.role, pinHash: hashPin(input.pin), pinEncrypted: encryptPin(input.pin), active: input.active ?? true })
    .returning();
  return row;
}

/** Εμφάνιση του PIN ενός υπαλλήλου στον διαχειριστή. Καταγράφεται στο ιστορικό. */
export async function revealPin(employeeId: number, byEmployeeId: number): Promise<string | null> {
  const db = await getDb();
  const e = await db.query.employees.findFirst({ where: eq(schema.employees.id, employeeId) });
  if (!e) throw new Error("Ο υπάλληλος δεν βρέθηκε");
  const pin = decryptPin(e.pinEncrypted);
  await audit(db, byEmployeeId, "pin_reveal", "employee", employeeId, { name: e.name, found: pin !== null });
  return pin;
}
