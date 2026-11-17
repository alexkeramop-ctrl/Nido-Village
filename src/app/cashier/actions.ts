"use server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { requireRole } from "@/server/auth";
import { run, type ActionResult } from "@/server/action";
import { REGISTER_COOKIE } from "@/server/register-cookie";
import { deviceRegister } from "@/server/services/device-register";
import type { EmployeeRole, PaymentMethod } from "@/db/schema";
import type { TenderInput } from "@/lib/tender";
import { addPayment, applyDiscount, printBill } from "@/server/services/billing";
import type { CartLine } from "@/server/services/ordering";
import { markPickedUp } from "@/server/services/public-order";
import { closeRegisterShift, listRegisters, openRegisterShift, toShiftDto, type ShiftDto } from "@/server/services/registers";
import { payOrderAtTill, quickSale, type PayOrderInput, type QuickSaleInput, type SaleDiscount, type SaleResult } from "@/server/services/till";

const ROLES: EmployeeRole[] = ["cashier", "manager", "admin"];
const MAX_LINES = 60;
const MAX_QTY = 99;

function revalidate(sessionId?: number) {
  revalidatePath("/cashier");
  revalidatePath("/pda");
  if (sessionId) {
    revalidatePath(`/cashier/s/${sessionId}`);
    revalidatePath(`/pda/s/${sessionId}`);
  }
}

const posInt = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const cents = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_00) throw new Error("Μη έγκυρο ποσό");
  return n;
};

/* ------------------------------ Ταμείο & βάρδια ------------------------------ */

/** Η συσκευή «δένεται» με ένα ταμείο (cookie 1 έτους). null = αλλαγή ταμείου. Ξαναφορτώνει σκόπιμα τη σελίδα. */
export async function selectRegisterAction(registerId: number | null): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    const store = await cookies();
    if (registerId === null) {
      store.delete(REGISTER_COOKIE);
    } else {
      const id = posInt(registerId);
      const register = (await listRegisters()).find((r) => r.id === id);
      if (!register) throw new Error("Το ταμείο δεν βρέθηκε ή είναι απενεργοποιημένο");
      const proto = ((await headers()).get("x-forwarded-proto") ?? "").split(",")[0].trim();
      store.set(REGISTER_COOKIE, String(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 3600, secure: proto === "https" });
    }
    revalidatePath("/cashier");
    return undefined;
  });
}

export async function openShiftAction(registerId: number, openingFloatCents: number): Promise<ActionResult<{ id: number }>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const row = await openRegisterShift(posInt(registerId), cents(openingFloatCents), user.id);
    revalidatePath("/cashier");
    return { id: row.id };
  });
}

/**
 * Κλείσιμο ταμείου. Επιστρέφει την τελική σύνοψη για την οθόνη/εκτύπωση. Δεν ξαναφορτώνει τη σελίδα:
 * ο ταμίας βλέπει πρώτα το αποτέλεσμα (διαφορά) και η σελίδα ανανεώνεται όταν πατήσει «Τέλος».
 */
export async function closeShiftAction(cashSessionId: number, countedCashCents: number, notes?: string): Promise<ActionResult<ShiftDto>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const summary = await closeRegisterShift(posInt(cashSessionId), cents(countedCashCents), user.id, notes ? String(notes).slice(0, 300) : null);
    return toShiftDto(summary);
  });
}

/* ------------------------------ Γρήγορη πώληση ------------------------------ */

function cleanLines(raw: unknown): CartLine[] {
  const lines = Array.isArray(raw) ? raw : [];
  if (lines.length > MAX_LINES) throw new Error("Πάρα πολλά είδη σε μία πώληση");
  return lines.map((l: Partial<CartLine> | null) => ({
    productId: posInt(l?.productId),
    qty: Math.min(MAX_QTY, Math.max(0, Math.round(Number(l?.qty) || 0))),
    modifierIds: Array.isArray(l?.modifierIds) ? l.modifierIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20) : [],
    notes: l?.notes ? String(l.notes).trim().slice(0, 120) : null,
    course: 1,
  }));
}

function cleanTender(t: Partial<TenderInput> | null | undefined): TenderInput {
  return {
    cashCents: cents(t?.cashCents ?? 0),
    cardCents: cents(t?.cardCents ?? 0),
    tenderedCashCents: t?.tenderedCashCents === null || t?.tenderedCashCents === undefined ? null : cents(t.tenderedCashCents),
  };
}

function cleanDiscount(d: Partial<SaleDiscount> | null | undefined): SaleDiscount | null {
  if (!d) return null;
  return { cents: cents(d.cents ?? 0), reason: String(d.reason ?? "").trim().slice(0, 120) };
}

function cleanBuzzer(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error("Ο βομβητής πρέπει να είναι αριθμός από 1 έως 999");
  return n;
}

/**
 * Η πώληση του ταμείου: ΜΙΑ κλήση, μία συναλλαγή στη βάση.
 * Σκόπιμα ΧΩΡΙΣ revalidatePath / cookies / redirect: αλλιώς το Next ξαναφορτώνει όλη τη σελίδα (και τον κατάλογο)
 * μετά από κάθε πώληση και το ταμείο «κολλάει». Η οθόνη ενημερώνεται από το αποτέλεσμα.
 */
export async function quickSaleAction(input: QuickSaleInput): Promise<ActionResult<SaleResult>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    return quickSale(
      {
        cashSessionId: posInt(input?.cashSessionId),
        clientRef: String(input?.clientRef ?? "").slice(0, 64),
        buzzerNo: cleanBuzzer(input?.buzzerNo),
        customerName: input?.customerName ? String(input.customerName).trim().slice(0, 40) : null,
        notes: input?.notes ? String(input.notes).trim().slice(0, 200) : null,
        lines: cleanLines(input?.lines),
        discount: cleanDiscount(input?.discount),
        tender: cleanTender(input?.tender),
        expectedTotalCents: input?.expectedTotalCents === null || input?.expectedTotalCents === undefined ? null : cents(input.expectedTotalCents),
      },
      user,
      { deferFiscal: true },
    );
  });
}

/** Πληρωμή παραγγελίας QR (ή παλιού ανοιχτού λογαριασμού) στο ταμείο, με βομβητή. Επίσης χωρίς ανανέωση σελίδας. */
export async function payOrderAtTillAction(input: PayOrderInput): Promise<ActionResult<SaleResult>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    return payOrderAtTill(
      {
        sessionId: posInt(input?.sessionId),
        cashSessionId: posInt(input?.cashSessionId),
        buzzerNo: cleanBuzzer(input?.buzzerNo),
        discount: cleanDiscount(input?.discount),
        tender: cleanTender(input?.tender),
      },
      user,
      { deferFiscal: true },
    );
  });
}

// Η ανανέωση στο παρασκήνιο (εκκρεμείς, σύνολα βάρδιας, εξαντλημένα) γίνεται με GET /api/till και όχι με action,
// γιατί το Next εκτελεί τα actions ένα-ένα και μια ανανέωση δεν πρέπει να καθυστερεί την επόμενη πώληση.

/** Ο πελάτης παρέλαβε (επέστρεψε τον βομβητή). Χωρίς ανανέωση σελίδας: το ταμείο ξαναρωτά μόνο του. */
export async function handedOverAction(sessionId: number): Promise<ActionResult> {
  return run(async () => {
    await requireRole(...ROLES);
    if (!posInt(sessionId)) throw new Error("Μη έγκυρη παραγγελία");
    await markPickedUp(sessionId);
    return undefined;
  });
}

/* --------------------- Παλιός λογαριασμός (/cashier/s/[id]) --------------------- */

/** Έκπτωση σε ανοιχτό λογαριασμό: μόνο υπεύθυνος ή διαχειριστής. */
export async function applyDiscountAction(sessionId: number, discountCents: number, reason: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireRole("manager", "admin");
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

/** Πληρωμή (και μερική) σε ανοιχτό λογαριασμό: χρεώνεται στη βάρδια του ταμείου αυτής της συσκευής. */
export async function addPaymentAction(
  sessionId: number,
  input: { method: PaymentMethod; amountCents: number; tenderedCents?: number },
): Promise<ActionResult<{ closed: boolean; changeCents: number; paymentId: number }>> {
  return run(async () => {
    const user = await requireRole(...ROLES);
    const { register } = await deviceRegister();
    if (!register?.openShift) throw new Error("Άνοιξε βάρδια στο ταμείο πρώτα");
    const res = await addPayment(sessionId, { method: input.method, amountCents: input.amountCents, tenderedCents: input.tenderedCents }, user.id, { cashSessionId: register.openShift.id });
    revalidate(sessionId);
    return { closed: res.closed, changeCents: res.changeCents, paymentId: res.payment.id };
  });
}
