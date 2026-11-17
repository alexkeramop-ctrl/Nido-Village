/** Σειριοποιήσιμοι τύποι για το ημερολόγιο εκδηλώσεων (server page -> client components). */
import type { EventSource, EventStatus, EventType, PartyDetails } from "@/db/schema";
import type { PaySummary } from "@/components/admin/bookings/meta";

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
  /** Συμφωνημένη προκαταβολή (οι εισπράξεις είναι στο `pay`). */
  depositCents: number;
  menuNotes: string | null;
  notes: string | null;
  party: PartyDetails | null;
  /** "website" = αίτημα από τη φόρμα του site. */
  source: EventSource;
  /** Τιμή, εισπράξεις και υπόλοιπο από τις πληρωμές της κράτησης. */
  pay: PaySummary;
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
  /** Συμφωνημένη προκαταβολή. Οι εισπράξεις καταχωρούνται ως πληρωμές, όχι από τη φόρμα. */
  depositCents: number;
  menuNotes: string | null;
  notes: string | null;
  party: PartyDetails | null;
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
