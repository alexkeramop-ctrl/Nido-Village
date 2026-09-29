"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth";
import { run, type ActionResult } from "@/server/action";
import { markPickedUp } from "@/server/services/public-order";

/** Το back-office σημειώνει ότι μια παραγγελία QR παραδόθηκε στον πελάτη. */
export async function markPickedUpAction(sessionId: number): Promise<ActionResult> {
  return run(async () => {
    await requireRole("manager", "admin");
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error("Μη έγκυρη παραγγελία");
    await markPickedUp(sessionId);
    revalidatePath("/admin/qr");
    revalidatePath("/cashier");
    return undefined;
  });
}
