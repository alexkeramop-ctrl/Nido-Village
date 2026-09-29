/** Μετατροπή του SessionDetail (server) σε απλό, σειριοποιήσιμο DTO. Μόνο για server components. */
import { lineTotalCents, type SessionDetail } from "@/server/services/billing";
import type { SessionDto, SessionItemDto } from "./types";

export function toSessionDto(s: SessionDetail): SessionDto {
  const items: SessionItemDto[] = s.items.map((i) => ({
    id: i.id,
    orderId: i.orderId,
    qty: i.qty,
    name: i.nameSnapshot,
    unitPriceCents: i.unitPriceCents,
    modifiers: i.modifiers.map((m) => ({ name: m.nameSnapshot, priceDeltaCents: m.priceDeltaCents })),
    notes: i.notes,
    course: i.course,
    status: i.status,
    lineTotalCents: lineTotalCents(i),
    voidReason: i.voidReason,
  }));
  const byOrder = new Map<number, SessionItemDto[]>();
  for (const it of items) byOrder.set(it.orderId, [...(byOrder.get(it.orderId) ?? []), it]);
  return {
    id: s.id,
    displayName: s.displayName,
    orderType: s.orderType,
    status: s.status,
    tableId: s.tableId,
    areaName: s.table?.area?.name ?? null,
    label: s.label,
    covers: s.covers,
    waiter: s.openedByEmployee.name,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    billPrintedAt: s.billPrintedAt ? s.billPrintedAt.toISOString() : null,
    discountReason: s.discountReason,
    totals: {
      subtotalCents: s.totals.subtotalCents,
      discountCents: s.totals.discountCents,
      totalCents: s.totals.totalCents,
      paidCents: s.totals.paidCents,
      dueCents: s.totals.dueCents,
      vat: s.totals.vat.map((v) => ({ ratePct: v.ratePct, grossCents: v.grossCents, vatCents: v.vatCents, netCents: v.netCents })),
    },
    rounds: s.orders.map((o) => ({
      id: o.id,
      roundNo: o.roundNo,
      createdAt: o.createdAt.toISOString(),
      employee: o.employee.name,
      notes: o.notes,
      items: byOrder.get(o.id) ?? [],
    })),
    items,
    payments: s.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amountCents: p.amountCents,
      tenderedCents: p.tenderedCents,
      changeCents: p.changeCents,
      createdAt: p.createdAt.toISOString(),
      employee: p.employee.name,
    })),
  };
}
