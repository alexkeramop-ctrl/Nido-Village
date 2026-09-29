import type { Metadata } from "next";
import { getSettings } from "@/server/services/settings";
import { listPickupBoard } from "@/server/services/public-order";
import { BoardClient } from "./board-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return { title: `Παραλαβές · ${settings.venueName}` };
}

/** Πίνακας παραλαβών για οθόνη/TV στο ταμείο. Δημόσιος, χωρίς σύνδεση. */
export default async function PickupPage() {
  const [rows, settings] = await Promise.all([listPickupBoard(), getSettings()]);
  return <BoardClient venueName={settings.venueName} rows={rows} />;
}
