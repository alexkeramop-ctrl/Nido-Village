"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import type { FinanceMethod } from "@/db/schema";
import { deleteFinanceEntry, getFinanceEntry, markFinanceEntryPaid, upsertFinanceEntry, type FinanceInput } from "@/server/services/finance";
import { trashDriveFile } from "@/server/services/google-drive";

function revalidate() {
  revalidatePath("/admin/finance");
  revalidatePath("/admin");
}

export async function saveFinanceEntryAction(input: FinanceInput) {
  return run(async () => {
    const me = await requireRole("admin");
    const row = await upsertFinanceEntry(input, me.id);
    revalidate();
    return row.id;
  });
}

/**
 * Διαγραφή κίνησης. Με trashFile το συνημμένο πάει και στον κάδο του Google Drive·
 * αν αυτό αποτύχει, η κίνηση διαγράφεται κανονικά και επιστρέφει προειδοποίηση.
 */
export async function deleteFinanceEntryAction(id: number, opts: { trashFile?: boolean } = {}) {
  return run(async () => {
    const me = await requireRole("admin");
    const entry = await getFinanceEntry(id);
    await deleteFinanceEntry(id, me.id);
    let warning: string | null = null;
    if (opts.trashFile && entry?.attachmentFileId) {
      try {
        await trashDriveFile(entry.attachmentFileId);
      } catch (e) {
        warning = `Η κίνηση διαγράφηκε, αλλά το αρχείο έμεινε στο Drive: ${e instanceof Error ? e.message : "άγνωστο σφάλμα"}`;
      }
    }
    revalidate();
    return { warning };
  });
}

/** «Σήμανση ως πληρωμένο» για απλήρωτο τιμολόγιο. */
export async function markFinanceEntryPaidAction(id: number, input: { method: FinanceMethod; paidAt?: string | null }) {
  return run(async () => {
    const me = await requireRole("admin");
    await markFinanceEntryPaid(id, input, me.id);
    revalidate();
  });
}
