import type { Metadata } from "next";
import Link from "next/link";
import { shareMeta } from "@/server/share-meta";
import { getSettings } from "@/server/services/settings";
import { getPublicMenu, qrAreasStatus } from "@/server/services/public-order";
import { Mark } from "@/components/brand";
import { qrOrderingEnabled } from "@/server/features";
import { OrderClient } from "./order-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const title = `${settings.venueName} · Παραγγελία για παραλαβή`;
  return { title, ...shareMeta(title, "Παράγγειλε από το κινητό σου και θα σε ειδοποιήσουμε όταν η παραγγελία σου είναι έτοιμη για παραλαβή.") };
}

/**
 * Δημόσια σελίδα παραγγελίας από QR. Χωρίς σύνδεση.
 * ?a=<χώρος>: το QR κάθε χώρου (π.χ. Παιδική χαρά). Η παραγγελία πάει στο ταμείο που δέχεται τον χώρο· αν κανένα δεν τον δέχεται,
 * ο πελάτης βλέπει το μενού αλλά παραγγέλνει στο ταμείο. Χωρίς ?a και με πολλούς χώρους: ο πελάτης διαλέγει πού κάθεται.
 * Με κλειστές τις παραγγελίες QR (src/server/features.ts): μόνο το μενού, για κάθε χώρο.
 */
export default async function OrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.a) ? sp.a[0] : sp.a;
  const [menu, settings, areas] = await Promise.all([getPublicMenu(), getSettings(), qrAreasStatus()]);
  const enabled = qrOrderingEnabled();
  const area = enabled ? (areas.find((a) => String(a.id) === raw) ?? (areas.length === 1 ? areas[0] : null)) : null;
  if (enabled && !area && areas.length > 1) {
    return (
      <main className="flex-1 max-w-lg w-full mx-auto p-4 space-y-4">
        <header className="flex items-center gap-3">
          <Mark height={44} />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-ink-3 font-semibold truncate">{settings.venueName}</div>
            <h1 className="text-xl font-bold leading-tight text-brand">Πού κάθεσαι;</h1>
          </div>
        </header>
        <ul className="grid gap-3" aria-label="Χώροι">
          {areas.map((a) => (
            <li key={a.id}>
              <Link href={{ pathname: "/order", query: { a: a.id } }} className="card p-5 flex items-center justify-between gap-3 touch">
                <span className="text-xl font-bold">{a.name}</span>
                {!a.open && <span className="text-xs text-ink-3">παραγγελία στο ταμείο</span>}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <OrderClient
      key={area?.id ?? 0}
      menu={menu}
      venueName={settings.venueName}
      area={area ? { id: area.id, name: area.name } : null}
      open={enabled && (area ? area.open : true)}
      contact={{ venueName: settings.venueName, address: settings.address, phone: settings.phone, email: settings.email }}
    />
  );
}
