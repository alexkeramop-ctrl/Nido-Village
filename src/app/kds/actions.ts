"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth";
import { run, type ActionResult } from "@/server/action";
import type { EmployeeRole } from "@/db/schema";
import { bumpOrder, setItemStatus } from "@/server/services/ordering";
import { markPickedUp } from "@/server/services/public-order";

/** Η οθόνη κουζίνας/μπαρ είναι για υπεύθυνο και διαχειριστή (όπως η σελίδα /kds). */
const ROLES: EmployeeRole[] = ["manager", "admin"];

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

/** «ΕΤΟΙΜΟ»: επιστρέφει αν όλη η παραγγελία είναι έτοιμη και ποιος βομβητής πρέπει να χτυπήσει. */
export async function bumpOrderAction(orderId: number, stationId: number | null): Promise<ActionResult<{ allReady: boolean; buzzerNo: number | null; name: string } | null>> {
  return run(async () => {
    await requireRole(...ROLES);
    const r = await bumpOrder(orderId, stationId);
    revalidatePath("/kds");
    return r ? { allReady: r.allReady, buzzerNo: r.buzzerNo, name: r.name } : null;
  });
}

/** Ο πελάτης πήρε την παραγγελία του (επέστρεψε τον βομβητή). */
export async function markPickedUpAction(sessionId: number): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error("Μη έγκυρη παραγγελία");
    await markPickedUp(sessionId);
    revalidatePath("/kds");
    return undefined;
  });
}
