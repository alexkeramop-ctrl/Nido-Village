import type { Metadata } from "next";
import { shareMeta } from "@/server/share-meta";
import { getSettings } from "@/server/services/settings";
import { getPublicMenu, getQrTable } from "@/server/services/public-order";
import { OrderClient } from "./order-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  if (!settings.qrOrdering) {
    const title = `${settings.venueName} · Μενού`;
    return { title, ...shareMeta(title, "Δες το μενού μας: πίτσες, burgers, brunch, καφέδες και ποτά. Παραγγελία και πληρωμή στο ταμείο.") };
  }
  const title = `${settings.venueName} · Παραγγελία για παραλαβή`;
  return { title, ...shareMeta(title, "Παράγγειλε από το κινητό σου και θα σε ειδοποιήσουμε όταν η παραγγελία σου είναι έτοιμη για παραλαβή.") };
}

/**
 * Δημόσια σελίδα του QR. Χωρίς σύνδεση. Όσο οι παραγγελίες QR είναι κλειστές (settings.qrOrdering) δείχνει ΜΟΝΟ το μενού.
 * Όταν ανοίξουν:
 * Με ?t=<τραπέζι> (QR του τραπεζιού) η παραγγελία γράφει το τραπέζι, τα ροφήματα πάνε στο μπαρ του χώρου του
 * και εμφανίζεται στο ταμείο που δέχεται QR από εκείνο τον χώρο. Χωρίς ?t= είναι παραγγελία για πακέτο.
 */
export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const settings = await getSettings();
  const [menu, table] = await Promise.all([getPublicMenu(), raw && settings.qrOrdering ? getQrTable(Number(raw)) : Promise.resolve(null)]);
  return (
    <OrderClient
      menu={menu}
      venueName={settings.venueName}
      table={table ? { id: table.id, name: table.name, areaName: table.areaName } : null}
      tableMissing={settings.qrOrdering && Boolean(raw) && !table}
      printAfterPayment={settings.qrPrintAfterPayment}
      ordering={settings.qrOrdering}
      contact={{ venueName: settings.venueName, address: settings.address, phone: settings.phone, email: settings.email }}
    />
  );
}
