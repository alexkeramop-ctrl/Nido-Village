import { headers } from "next/headers";
import { toDataURL } from "qrcode";
import { LiveRefresh } from "@/components/live";
import { requirePageUser } from "@/server/page-auth";
import { getSettings } from "@/server/services/settings";
import { listRecentQrOrders } from "@/server/services/public-order";
import { QrClient } from "./qr-client";

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
  const [qrDataUrl, orders, settings] = await Promise.all([toDataURL(orderUrl, { width: 512, margin: 2 }), listRecentQrOrders(50), getSettings()]);
  return (
    <>
      <LiveRefresh types={["session.changed"]} />
      <QrClient
        venueName={settings.venueName}
        orderUrl={orderUrl}
        pickupUrl={pickupUrl}
        qrDataUrl={qrDataUrl}
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
