import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";

export type VenueSettings = {
  venueName: string;
  vatNumber: string;
  taxOffice: string;
  address: string;
  phone: string;
  /** Email επικοινωνίας: εμφανίζεται στις δημόσιες σελίδες (παραγγελία QR, κατάσταση) και στην απόδειξη. Κενό = δεν εμφανίζεται. */
  email: string;
  /** Προεπιλεγμένος αριθμός πιάτων (courses) στο PDA. */
  courses: number;
  /** Στόχος food cost (% της καθαρής τιμής πώλησης) για την Κοστολόγηση. */
  foodCostTargetPct: number;
  /** Στόχος drink cost (% της καθαρής τιμής πώλησης) για την Κοστολόγηση. */
  drinkCostTargetPct: number;
  /**
   * Παραγγελίες από QR. ΚΛΕΙΣΤΕΣ: το QR δείχνει μόνο το μενού. Θα ανοίξουν μόνο μαζί με online πληρωμή
   * (απόφαση ιδιοκτήτη, 21/11/2026). Δεν έχει διακόπτη στη Διαχείριση.
   */
  qrOrdering: boolean;
  /** Παραγγελίες QR (όταν ανοίξουν): τυπώνονται στην κουζίνα/μπαρ μόνο όταν πληρωθούν (όχι τη στιγμή που τις στέλνει ο πελάτης). */
  qrPrintAfterPayment: boolean;
};

export const DEFAULT_SETTINGS: VenueSettings = {
  venueName: "Nido Village",
  vatNumber: "",
  taxOffice: "",
  address: "",
  phone: "",
  email: "info@nidovillage.gr",
  courses: 1,
  foodCostTargetPct: 30,
  drinkCostTargetPct: 22,
  qrOrdering: false,
  qrPrintAfterPayment: true,
};

export async function getSettings(): Promise<VenueSettings> {
  const db = await getDb();
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "venue") });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<VenueSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<VenueSettings>) {
  const db = await getDb();
  const current = await getSettings();
  const value = { ...current, ...patch };
  await db
    .insert(schema.settings)
    .values({ key: "venue", value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  emit({ type: "catalog.changed" });
  return value;
}
