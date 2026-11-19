import type { Metadata } from "next";
import { shareMeta } from "@/server/share-meta";
import { getSettings } from "@/server/services/settings";
import { getPublicMenu } from "@/server/services/public-order";
import { OrderClient } from "./order-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const title = `${settings.venueName} · Παραγγελία για παραλαβή`;
  return { title, ...shareMeta(title, "Παράγγειλε από το κινητό σου και θα σε ειδοποιήσουμε όταν η παραγγελία σου είναι έτοιμη για παραλαβή.") };
}

/** Δημόσια σελίδα παραγγελίας από QR (take away). Χωρίς σύνδεση. Το ?t=<τραπέζι> αγνοείται προς το παρόν. */
export default async function OrderPage() {
  const [menu, settings] = await Promise.all([getPublicMenu(), getSettings()]);
  return <OrderClient menu={menu} venueName={settings.venueName} contact={{ venueName: settings.venueName, address: settings.address, phone: settings.phone, email: settings.email }} />;
}
