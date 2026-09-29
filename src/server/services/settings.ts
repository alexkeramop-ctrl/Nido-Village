import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";

export type VenueSettings = {
  venueName: string;
  vatNumber: string;
  taxOffice: string;
  address: string;
  phone: string;
  /** Προεπιλεγμένος αριθμός πιάτων (courses) στο PDA. */
  courses: number;
};

export const DEFAULT_SETTINGS: VenueSettings = {
  venueName: "Nido Village",
  vatNumber: "",
  taxOffice: "",
  address: "",
  phone: "",
  courses: 3,
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
