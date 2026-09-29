"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth";
import { run, type ActionResult } from "@/server/action";
import type { EmployeeRole, PaymentMethod } from "@/db/schema";
import { addPayment, applyDiscount, closeCashSession, openCashSession, printBill } from "@/server/services/billing";

const ROLES: EmployeeRole[] = ["cashier", "manager", "admin"];

function revalidate(sessionId?: number) {
  revalidatePath("/cashier");
  revalidatePath("/pda");
  if (sessionId) {
    revalidatePath(`/cashier/s/${sessionId}`);
    revalidatePath(`/pda/s/${sessionId}`);
  }
}

export async function openCashShiftAction(openingFloatCents: number): Promise<ActionResult<{ id: number }>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const row = await openCashSession(openingFloatCents, user.id);
    revalidate();
    return { id: row.id };
  });
}

export async function closeCashShiftAction(
  countedCashCents: number,
  notes?: string,
): Promise<ActionResult<{ expectedCashCents: number; countedCashCents: number; diffCents: number; totalCents: number }>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const res = await closeCashSession(countedCashCents, user.id, notes?.trim() || undefined);
    revalidate();
    return {
      expectedCashCents: res.expectedCashCents,
      countedCashCents: Math.round(countedCashCents),
      diffCents: Math.round(countedCashCents) - res.expectedCashCents,
      totalCents: res.totalCents,
    };
  });
}

export async function applyDiscountAction(sessionId: number, discountCents: number, reason: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    await applyDiscount(sessionId, discountCents, reason, user.id);
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

export async function addPaymentAction(
  sessionId: number,
  input: { method: PaymentMethod; amountCents: number; tenderedCents?: number },
): Promise<ActionResult<{ closed: boolean; changeCents: number; paymentId: number }>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const res = await addPayment(sessionId, { method: input.method, amountCents: input.amountCents, tenderedCents: input.tenderedCents }, user.id);
    revalidate(sessionId);
    return { closed: res.closed, changeCents: res.changeCents, paymentId: res.payment.id };
  });
}
