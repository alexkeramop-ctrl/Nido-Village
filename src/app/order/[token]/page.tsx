import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/server/services/settings";
import { getPublicOrder } from "@/server/services/public-order";
import { StatusClient } from "./status-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const [order, settings] = await Promise.all([getPublicOrder(token), getSettings()]);
  return { title: order ? `#${order.code} · ${settings.venueName}` : `Παραγγελία · ${settings.venueName}` };
}

/** Δημόσια σελίδα κατάστασης παραγγελίας QR. Χωρίς σύνδεση· το token είναι το «κλειδί». */
export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [order, settings] = await Promise.all([getPublicOrder(token), getSettings()]);
  if (!order) {
    return (
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="card p-8 max-w-sm w-full text-center space-y-3">
          <div className="text-4xl" aria-hidden>
            🔍
          </div>
          <h1 className="text-xl font-bold">Η παραγγελία δεν βρέθηκε</h1>
          <p className="text-sm text-ink-3">Ο σύνδεσμος μπορεί να είναι λάθος ή παλιός. Αν μόλις παρήγγειλες, ρώτησε στο ταμείο.</p>
          <Link href="/order" className="btn-primary w-full">
            Νέα παραγγελία
          </Link>
        </div>
      </main>
    );
  }
  return <StatusClient order={order} token={token} venueName={settings.venueName} />;
}
