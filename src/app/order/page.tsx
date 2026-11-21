import type { Metadata } from "next";
import { shareMeta } from "@/server/share-meta";
import { getSettings } from "@/server/services/settings";
import { getPublicMenu, getQrTable } from "@/server/services/public-order";
import { OrderClient } from "./order-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const title = `${settings.venueName} · Παραγγελία για παραλαβή`;
  return { title, ...shareMeta(title, "Παράγγειλε από το κινητό σου και θα σε ειδοποιήσουμε όταν η παραγγελία σου είναι έτοιμη για παραλαβή.") };
}

/**
 * Δημόσια σελίδα παραγγελίας από QR. Χωρίς σύνδεση.
 * Με ?t=<τραπέζι> (QR του τραπεζιού) η παραγγελία γράφει το τραπέζι, τα ροφήματα πάνε στο μπαρ του χώρου του
 * και εμφανίζεται στο ταμείο που δέχεται QR από εκείνο τον χώρο. Χωρίς ?t= είναι παραγγελία για πακέτο.
 */
export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const [menu, settings, table] = await Promise.all([getPublicMenu(), getSettings(), raw ? getQrTable(Number(raw)) : Promise.resolve(null)]);
  return (
    <OrderClient
      menu={menu}
      venueName={settings.venueName}
      table={table ? { id: table.id, name: table.name, areaName: table.areaName } : null}
      tableMissing={Boolean(raw) && !table}
      contact={{ venueName: settings.venueName, address: settings.address, phone: settings.phone, email: settings.email }}
    />
  );
}
