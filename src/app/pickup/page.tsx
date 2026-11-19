import type { Metadata } from "next";
import { shareMeta } from "@/server/share-meta";
import { getSettings } from "@/server/services/settings";
import { listPickupBoard } from "@/server/services/public-order";
import { BoardClient } from "./board-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const title = `Παραλαβές · ${settings.venueName}`;
  return { title, ...shareMeta(title, "Οι κωδικοί των παραγγελιών που ετοιμάζονται και είναι έτοιμες για παραλαβή.") };
}

/** Πίνακας παραλαβών για οθόνη/TV στο ταμείο. Δημόσιος, χωρίς σύνδεση. */
export default async function PickupPage() {
  const [rows, settings] = await Promise.all([listPickupBoard(), getSettings()]);
  return <BoardClient venueName={settings.venueName} rows={rows} />;
}
