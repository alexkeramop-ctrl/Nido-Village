"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth";
import { run, type ActionResult } from "@/server/action";
import type { EmployeeRole } from "@/db/schema";
import { bumpOrder, setItemStatus } from "@/server/services/ordering";

/** Το KDS το χρησιμοποιεί κάθε συνδεδεμένος ρόλος. */
const ROLES: EmployeeRole[] = ["kitchen", "waiter", "cashier", "manager", "admin"];

export async function setItemStatusAction(itemId: number, status: "preparing" | "ready" | "served"): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    const row = await setItemStatus(itemId, status);
    if (!row) throw new Error("Το είδος δεν βρέθηκε ή έχει ακυρωθεί");
    revalidatePath("/kds");
    revalidatePath(`/pda/s/${row.sessionId}`);
    return undefined;
  });
}

export async function bumpOrderAction(orderId: number, stationId: number | null): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    await bumpOrder(orderId, stationId);
    revalidatePath("/kds");
    return undefined;
  });
}
