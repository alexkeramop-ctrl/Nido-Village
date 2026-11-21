/**
 * Κρατημένες παραγγελίες QR («τύπωμα μετά την πληρωμή»).
 * Ο πελάτης στέλνει παραγγελία από το κινητό: καταγράφεται (είδη, απόθεμα, σύνολο για το ταμείο) αλλά η κουζίνα και το μπαρ
 * ΔΕΝ τη βλέπουν. Μόλις εξοφληθεί στο ταμείο, η releaseHeldOrdersTx τυπώνει τα δελτία (με τον βομβητή) και τη δείχνει στην
 * οθόνη κουζίνας. Έτσι δεν ετοιμάζεται φαγητό για παραγγελία που δεν πληρώθηκε ποτέ.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { schema } from "@/db";
import type { DbLike } from "@/server/audit";
import { enqueueMany } from "@/server/printing/queue";
import { kitchenTicket, type KitchenItem } from "@/server/printing/templates";

/**
 * Απελευθερώνει τις κρατημένες παραγγελίες μιας συνεδρίας μέσα σε ΥΠΑΡΧΟΥΣΑ συναλλαγή (καλείται όταν εξοφλείται).
 * Επιστρέφει τα id των παραγγελιών που απελευθερώθηκαν και πόσα δελτία μπήκαν στην ουρά εκτύπωσης.
 */
export async function releaseHeldOrdersTx(tx: DbLike, sessionId: number, now: Date = new Date()): Promise<{ orderIds: number[]; jobs: number }> {
  const held = await tx.query.orders.findMany({
    where: and(eq(schema.orders.sessionId, sessionId), eq(schema.orders.held, true)),
    with: {
      employee: true,
      session: { with: { table: true } },
      items: { with: { modifiers: true, printStation: true } },
    },
  });
  if (!held.length) return { orderIds: [], jobs: 0 };
  const orderIds = held.map((o) => o.id);
  // Η ώρα αποστολής στην κουζίνα είναι η ώρα πληρωμής (η ώρα παραγγελίας μένει στη συνεδρία).
  await tx.update(schema.orders).set({ held: false, createdAt: now }).where(inArray(schema.orders.id, orderIds));
  await tx
    .update(schema.orderItems)
    .set({ sentAt: now })
    .where(and(inArray(schema.orderItems.orderId, orderIds), ne(schema.orderItems.status, "voided")));

  const jobs: Parameters<typeof enqueueMany>[1] = [];
  for (const o of held) {
    const s = o.session;
    const byStation = new Map<number, { station: { id: number; name: string; columns: number }; items: KitchenItem[] }>();
    for (const it of [...o.items].sort((a, b) => a.id - b.id)) {
      if (it.status === "voided" || !it.printStation?.enabled) continue;
      const entry = byStation.get(it.printStation.id) ?? { station: it.printStation, items: [] };
      entry.items.push({ qty: it.qty, name: it.nameSnapshot, modifiers: it.modifiers.map((m) => m.nameSnapshot), notes: it.notes, course: it.course });
      byStation.set(it.printStation.id, entry);
    }
    for (const { station, items } of byStation.values()) {
      jobs.push({
        station,
        kind: "kitchen_ticket",
        doc: kitchenTicket({
          stationName: station.name,
          tableName: s.table ? s.table.name : s.label ?? `#${s.id}`,
          orderType: s.orderType,
          label: s.label,
          waiter: o.employee.name,
          roundNo: o.roundNo,
          time: now,
          items,
          notes: o.notes,
          buzzerNo: s.buzzerNo,
          customerName: s.customerName,
          typeLabel: null,
        }),
      });
    }
  }
  const queued = await enqueueMany(tx, jobs);
  return { orderIds, jobs: queued.length };
}
