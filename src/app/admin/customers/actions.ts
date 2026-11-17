"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { customersCsv, deleteCustomer, findCustomerByPhone, saveCustomer, setCustomerConsent, type CustomerInput } from "@/server/services/customers";

function revalidate() {
  revalidatePath("/admin/customers");
}

export async function saveCustomerAction(input: CustomerInput) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    const row = await saveCustomer(
      {
        id: input.id ? Number(input.id) : undefined,
        name: String(input.name ?? ""),
        phone: String(input.phone ?? ""),
        email: input.email ? String(input.email) : null,
        notes: input.notes ? String(input.notes) : null,
        marketingConsent: input.marketingConsent === undefined ? undefined : input.marketingConsent === true,
      },
      me.id,
    );
    revalidate();
    return row.id;
  });
}

/** Συγκατάθεση για ενημερώσεις (ναι/όχι). Καταγράφεται στο ιστορικό. */
export async function setCustomerConsentAction(id: number, consent: boolean) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    await setCustomerConsent(Number(id), consent === true, me.id);
    revalidate();
  });
}

/** Διαγραφή πελάτη (π.χ. αίτημα διαγραφής δεδομένων): μόνο ο διαχειριστής. */
export async function deleteCustomerAction(id: number) {
  return run(async () => {
    const me = await requireRole("admin");
    await deleteCustomer(Number(id), me.id);
    revalidate();
  });
}

/** CSV του πελατολογίου. "marketing" = μόνο όσοι έχουν συγκατάθεση. Η εξαγωγή καταγράφεται στο ιστορικό. */
export async function exportCustomersAction(mode: "all" | "marketing") {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    if (mode !== "all" && mode !== "marketing") throw new Error("Μη έγκυρη εξαγωγή");
    return customersCsv(mode, me.id);
  });
}

/** Για τη φόρμα κράτησης: ο υπάρχων πελάτης με αυτό το τηλέφωνο (ή null). */
export async function findCustomerByPhoneAction(phone: string) {
  return run(async () => {
    await requireRole("manager", "admin");
    return findCustomerByPhone(String(phone ?? ""));
  });
}
