/** Χρώματα/τόνοι ανά τύπο και κατάσταση εκδήλωσης (κοινά για ημερολόγιο και επισκόπηση). */
import type { EventStatus, EventType } from "@/db/schema";

export const EVENT_TYPES: EventType[] = ["wedding", "christening", "party", "school_trip", "corporate", "other"];
export const EVENT_STATUSES: EventStatus[] = ["inquiry", "confirmed", "cancelled", "done"];

/** Χρώμα chip στο πλέγμα του ημερολογίου. */
export const EVENT_TYPE_CHIP: Record<EventType, string> = {
  wedding: "bg-rose-100 text-rose-900 border-rose-200",
  christening: "bg-sky-100 text-sky-900 border-sky-200",
  party: "bg-amber-100 text-amber-900 border-amber-200",
  school_trip: "bg-green-100 text-green-900 border-green-200",
  corporate: "bg-indigo-100 text-indigo-900 border-indigo-200",
  other: "bg-gray-100 text-gray-800 border-gray-200",
};

/** Κουκκίδα χρώματος τύπου (υπόμνημα, λίστες). */
export const EVENT_TYPE_DOT: Record<EventType, string> = {
  wedding: "bg-rose-400",
  christening: "bg-sky-400",
  party: "bg-amber-400",
  school_trip: "bg-green-500",
  corporate: "bg-indigo-400",
  other: "bg-gray-400",
};

export const CANCELLED_CHIP = "bg-gray-100 text-gray-400 border-gray-200 line-through";

export const EVENT_STATUS_TONE: Record<EventStatus, "neutral" | "ok" | "warn" | "danger" | "brand"> = {
  inquiry: "warn",
  confirmed: "ok",
  cancelled: "danger",
  done: "brand",
};
