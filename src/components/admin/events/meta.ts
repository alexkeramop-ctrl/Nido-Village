/** Χρώματα/τόνοι ανά τύπο και κατάσταση εκδήλωσης (κοινά για ημερολόγιο και επισκόπηση). */
import type { EventStatus, EventType } from "@/db/schema";

export const EVENT_TYPES: EventType[] = ["wedding", "christening", "appointment", "party", "school_trip", "corporate", "other"];

/** Τα τρία ημερολόγια: όλα, γάμοι & βαπτίσεις (με ραντεβού), παιδικά πάρτι. */
export type CalendarScope = "all" | "ceremonies" | "parties";
export const SCOPES: Record<CalendarScope, { path: string; title: string; subtitle: string; types: EventType[]; newType: EventType; newLabel: string }> = {
  all: {
    path: "/admin/events",
    title: "Όλες οι εκδηλώσεις",
    subtitle: "γάμοι, βαπτίσεις, ραντεβού, πάρτι, σχολικές εκδρομές, εταιρικά",
    types: EVENT_TYPES,
    newType: "party",
    newLabel: "+ Νέα εκδήλωση",
  },
  ceremonies: {
    path: "/admin/ceremonies",
    title: "Γάμοι & Βαπτίσεις",
    subtitle: "δεξιώσεις και ραντεβού με τους πελάτες (γνωριμία, δοκιμή μενού, υπογραφή)",
    types: ["wedding", "christening", "appointment"],
    newType: "wedding",
    newLabel: "+ Νέα κράτηση / ραντεβού",
  },
  parties: {
    path: "/admin/parties",
    title: "Παιδικά πάρτι",
    subtitle: "πακέτα 2,5 ωρών με φαγητό και παιχνίδι",
    types: ["party"],
    newType: "party",
    newLabel: "+ Νέο πάρτι",
  },
};
export const EVENT_STATUSES: EventStatus[] = ["inquiry", "confirmed", "cancelled", "done"];

/** Χρώμα chip στο πλέγμα του ημερολογίου. */
export const EVENT_TYPE_CHIP: Record<EventType, string> = {
  wedding: "bg-rose-100 text-rose-900 border-rose-200",
  christening: "bg-sky-100 text-sky-900 border-sky-200",
  appointment: "bg-violet-100 text-violet-900 border-violet-200",
  party: "bg-amber-100 text-amber-900 border-amber-200",
  school_trip: "bg-green-100 text-green-900 border-green-200",
  corporate: "bg-indigo-100 text-indigo-900 border-indigo-200",
  other: "bg-gray-100 text-gray-800 border-gray-200",
};

/** Κουκκίδα χρώματος τύπου (υπόμνημα, λίστες). */
export const EVENT_TYPE_DOT: Record<EventType, string> = {
  wedding: "bg-rose-400",
  christening: "bg-sky-400",
  appointment: "bg-violet-400",
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

/** Εύρος ώρας για εμφάνιση: γάμοι και βαπτίσεις δείχνουν μόνο την ώρα έναρξης. */
export function timeRange(e: { type: EventType; startTime: string; endTime: string }): string {
  return e.type === "wedding" || e.type === "christening" ? e.startTime : `${e.startTime}–${e.endTime}`;
}
