import { headers } from "next/headers";
import { toDataURL } from "qrcode";
import { LiveRefresh } from "@/components/live";
import { requirePageUser } from "@/server/page-auth";
import { getSettings } from "@/server/services/settings";
import { listRecentQrOrders, qrAreasStatus } from "@/server/services/public-order";
import { qrOrderingEnabled } from "@/server/features";
import { QrClient, type QrCode } from "./qr-client";

export const dynamic = "force-dynamic";

/** Το δημόσιο origin όπως το βλέπει ο πελάτης (πίσω από reverse proxy: x-forwarded-*). */
async function publicOrigin(): Promise<string> {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || "http";
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export default async function AdminQrPage() {
  await requirePageUser("manager", "admin");
  const origin = await publicOrigin();
  const orderUrl = `${origin}/order`;
  const pickupUrl = `${origin}/pickup`;
  const [orders, settings, areas] = await Promise.all([listRecentQrOrders(50), getSettings(), qrAreasStatus()]);
  // Ένα QR ανά χώρο (πάει στο ταμείο που δέχεται τον χώρο) και ένα κοινό που ρωτά τον πελάτη πού κάθεται.
  const codes = [
    ...areas.map((a) => ({ key: `area-${a.id}`, label: a.name, area: a.name, url: `${orderUrl}?a=${a.id}`, open: a.open })),
    { key: "all", label: areas.length > 1 ? "Κοινό (ρωτά πού κάθεται)" : "Κοινό", area: null, url: orderUrl, open: null },
  ];
  // Κλειστές παραγγελίες QR (μέχρι να συνδεθεί online πληρωμή): κανένα QR για εκτύπωση.
  const qrs: QrCode[] = qrOrderingEnabled() ? await Promise.all(codes.map(async (c) => ({ ...c, dataUrl: await toDataURL(c.url, { width: 512, margin: 2 }) }))) : [];
  return (
    <>
      <LiveRefresh types={["session.changed"]} />
      <QrClient
        venueName={settings.venueName}
        qrs={qrs}
        pickupUrl={pickupUrl}
        orders={orders.map((o) => ({
          sessionId: o.sessionId,
          code: o.code,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          status: o.status,
          openedAt: o.openedAt.toISOString(),
          totalCents: o.totalCents,
        }))}
      />
    </>
  );
}
