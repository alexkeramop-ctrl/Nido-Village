/** Σειριοποιήσιμη μορφή συνεδρίας για τα client components (ημερομηνίες ως ISO strings). */
import type { ItemStatus, OrderType, PaymentMethod, SessionStatus } from "@/db/schema";

export type SessionItemDto = {
  id: number;
  orderId: number;
  qty: number;
  name: string;
  unitPriceCents: number;
  modifiers: { name: string; priceDeltaCents: number }[];
  notes: string | null;
  course: number;
  status: ItemStatus;
  lineTotalCents: number;
  voidReason: string | null;
};

export type SessionRoundDto = {
  id: number;
  roundNo: number;
  createdAt: string;
  employee: string;
  notes: string | null;
  items: SessionItemDto[];
};

export type SessionPaymentDto = {
  id: number;
  method: PaymentMethod;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number;
  createdAt: string;
  employee: string;
};

export type SessionTotalsDto = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  vat: { ratePct: number; grossCents: number; vatCents: number; netCents: number }[];
};

export type SessionDto = {
  id: number;
  displayName: string;
  orderType: OrderType;
  status: SessionStatus;
  tableId: number | null;
  areaName: string | null;
  label: string | null;
  covers: number;
  waiter: string;
  openedAt: string;
  closedAt: string | null;
  billPrintedAt: string | null;
  discountReason: string | null;
  totals: SessionTotalsDto;
  rounds: SessionRoundDto[];
  items: SessionItemDto[];
  payments: SessionPaymentDto[];
};
