"use server";
import { revalidatePath } from "next/cache";
import type { EventStatus } from "@/db/schema";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, conflictingEvents, deleteEvent, setEventStatus, upsertEvent } from "@/server/services/events";
import type { ConflictRow, EventFormInput } from "@/components/admin/events/types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function revalidate() {
  revalidatePath("/admin/events");
  revalidatePath("/admin");
}

export async function saveEventAction(input: EventFormInput) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    if (!input.title?.trim()) throw new Error("Απαιτείται τίτλος εκδήλωσης");
    if (!(input.type in EVENT_TYPE_LABEL)) throw new Error("Μη έγκυρος τύπος εκδήλωσης");
    if (!(input.status in EVENT_STATUS_LABEL)) throw new Error("Μη έγκυρη κατάσταση");
    if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) throw new Error("Μη έγκυρη ώρα");
    if (input.endTime <= input.startTime) throw new Error("Η ώρα λήξης πρέπει να είναι μετά την ώρα έναρξης");
    if (!Number.isFinite(input.priceCents) || input.priceCents < 0) throw new Error("Μη έγκυρη τιμή");
    if (!Number.isFinite(input.depositCents) || input.depositCents < 0) throw new Error("Μη έγκυρη προκαταβολή");
    if (input.depositCents > input.priceCents && input.priceCents > 0) throw new Error("Η προκαταβολή δεν μπορεί να ξεπερνά την τιμή");
    const row = await upsertEvent(
      {
        id: input.id,
        title: input.title,
        type: input.type,
        status: input.status,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        guests: input.guests,
        areaId: input.areaId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        priceCents: input.priceCents,
        depositCents: input.depositCents,
        depositPaid: input.depositPaid,
        menuNotes: input.menuNotes,
        notes: input.notes,
      },
      me.id,
    );
    revalidate();
    return row.id;
  });
}

export async function setEventStatusAction(id: number, status: EventStatus) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    if (!(status in EVENT_STATUS_LABEL)) throw new Error("Μη έγκυρη κατάσταση");
    await setEventStatus(id, status, me.id);
    revalidate();
  });
}

export async function deleteEventAction(id: number) {
  return run(async () => {
    const me = await requireRole("manager", "admin");
    await deleteEvent(id, me.id);
    revalidate();
  });
}

/** Εκδηλώσεις που συμπίπτουν σε ημέρα/ώρα/χώρο (για προειδοποίηση πριν την αποθήκευση). */
export async function checkConflictsAction(input: { id?: number; date: string; startTime: string; endTime: string; areaId?: number | null }) {
  return run(async (): Promise<ConflictRow[]> => {
    await requireRole("manager", "admin");
    if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) throw new Error("Μη έγκυρη ώρα");
    const rows = await conflictingEvents(input);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      startTime: r.startTime,
      endTime: r.endTime,
      areaName: r.area?.name ?? null,
    }));
  });
}
