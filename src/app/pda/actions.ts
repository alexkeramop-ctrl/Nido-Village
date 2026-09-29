"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/server/auth";
import { run, type ActionResult } from "@/server/action";
import type { EmployeeRole, OrderType } from "@/db/schema";
import {
  cancelSession,
  markServed,
  moveSession,
  openSession,
  sendRound,
  setCovers,
  voidItem,
  type CartLine,
} from "@/server/services/ordering";
import { printBill } from "@/server/services/billing";

const ROLES: EmployeeRole[] = ["waiter", "cashier", "manager", "admin"];

function revalidate(sessionId?: number) {
  revalidatePath("/pda");
  revalidatePath("/cashier");
  if (sessionId) {
    revalidatePath(`/pda/s/${sessionId}`);
    revalidatePath(`/cashier/s/${sessionId}`);
  }
}

/** Άνοιγμα (ή συνέχιση) τραπεζιού και μετάβαση στην οθόνη παραγγελίας. */
export async function openTableAction(tableId: number): Promise<ActionResult> {
  const r = await run(async () => {
    const user = await requireRole(...ROLES);
    const s = await openSession({ tableId }, user.id);
    revalidate();
    return s.id;
  });
  if (!r.ok) return r;
  redirect(`/pda/s/${r.data}`);
}

export async function openTakeawayAction(input: { label: string; orderType: "takeaway" | "delivery"; covers?: number }): Promise<ActionResult> {
  const r = await run(async () => {
    const user = await requireRole(...ROLES);
    const orderType: OrderType = input.orderType === "delivery" ? "delivery" : "takeaway";
    const s = await openSession({ tableId: null, orderType, label: input.label, covers: input.covers ?? 0 }, user.id);
    revalidate();
    return s.id;
  });
  if (!r.ok) return r;
  redirect(`/pda/s/${r.data}`);
}

export async function setCoversAction(sessionId: number, covers: number): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    await setCovers(sessionId, Math.max(0, Math.floor(covers)));
    revalidate(sessionId);
    return undefined;
  });
}

export async function sendRoundAction(sessionId: number, cart: CartLine[], notes?: string | null): Promise<ActionResult<{ orderId: number; roundNo: number }>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const order = await sendRound(sessionId, cart, user.id, notes);
    revalidate(sessionId);
    return { orderId: order.id, roundNo: order.roundNo };
  });
}

export async function voidItemAction(itemId: number, reason: string, sessionId?: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    await voidItem(itemId, reason, user.id);
    revalidate(sessionId);
    return undefined;
  });
}

export async function printBillAction(sessionId: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    await printBill(sessionId, user.id);
    revalidate(sessionId);
    return undefined;
  });
}

export async function markServedAction(sessionId: number): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    await markServed(sessionId);
    revalidate(sessionId);
    return undefined;
  });
}

export async function moveSessionAction(sessionId: number, tableId: number): Promise<ActionResult> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    await moveSession(sessionId, tableId, user.id);
    revalidate(sessionId);
    return undefined;
  });
}

/** Ακύρωση κενού τραπεζιού και επιστροφή στην κάτοψη. */
export async function cancelSessionAction(sessionId: number, reason: string): Promise<ActionResult> {
  const r = await run(async () => {
    const user = await requireRole(...ROLES);
    await cancelSession(sessionId, reason.trim() || "Ακύρωση από PDA", user.id);
    revalidate(sessionId);
    return undefined;
  });
  if (!r.ok) return r;
  redirect("/pda");
}
