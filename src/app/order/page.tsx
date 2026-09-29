import type { Metadata } from "next";
import { getSettings } from "@/server/services/settings";
import { getPublicMenu } from "@/server/services/public-order";
import { OrderClient } from "./order-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return { title: `${settings.venueName} · Παραγγελία για παραλαβή` };
}

/** Δημόσια σελίδα παραγγελίας από QR (take away). Χωρίς σύνδεση. Το ?t=<τραπέζι> αγνοείται προς το παρόν. */
export default async function OrderPage() {
  const [menu, settings] = await Promise.all([getPublicMenu(), getSettings()]);
  return <OrderClient menu={menu} venueName={settings.venueName} />;
}
