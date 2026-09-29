/** Σειριοποιήσιμοι τύποι για το ημερολόγιο εκδηλώσεων (server page -> client components). */
import type { EventStatus, EventType } from "@/db/schema";

export type EventRow = {
  id: number;
  title: string;
  type: EventType;
  status: EventStatus;
  date: string;
  startTime: string;
  endTime: string;
  guests: number;
  areaId: number | null;
  areaName: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  priceCents: number;
  depositCents: number;
  depositPaid: boolean;
  menuNotes: string | null;
  notes: string | null;
};

export type AreaOption = { id: number; name: string };

/** Είσοδος της φόρμας (ίδια δομή με το EventInput της υπηρεσίας). */
export type EventFormInput = {
  id?: number;
  title: string;
  type: EventType;
  status: EventStatus;
  date: string;
  startTime: string;
  endTime: string;
  guests: number;
  areaId: number | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  priceCents: number;
  depositCents: number;
  depositPaid: boolean;
  menuNotes: string | null;
  notes: string | null;
};

export type ConflictRow = {
  id: number;
  title: string;
  type: EventType;
  status: EventStatus;
  startTime: string;
  endTime: string;
  areaName: string | null;
};
