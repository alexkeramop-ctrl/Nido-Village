import Link from "next/link";
import { headers } from "next/headers";
import { toDataURL } from "qrcode";
import { PageHeader } from "@/components/admin/common";
import { requirePageUser } from "@/server/page-auth";
import { getSettings } from "@/server/services/settings";
import { listAreas } from "@/server/services/floor";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const PRINT_CSS = `
@media print {
  @page { margin: 10mm; }
  html, body { background: #fff; }
  body * { visibility: hidden; }
  #qr-sheet, #qr-sheet * { visibility: visible; }
  #qr-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  #qr-sheet .qr-card { break-inside: avoid; page-break-inside: avoid; }
}
`;

async function publicOrigin(): Promise<string> {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || "http";
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/**
 * QR ανά τραπέζι: κάθε QR ανοίγει το /order?t=<τραπέζι>. Η παραγγελία γράφει το τραπέζι, τα ροφήματα τυπώνονται στο μπαρ
 * του χώρου και εμφανίζεται στο ταμείο που δέχεται QR από εκείνο τον χώρο.
 */
export default async function TableQrPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const raw = Array.isArray(sp.a) ? sp.a[0] : sp.a;
  const [areas, settings, origin] = await Promise.all([listAreas(), getSettings(), publicOrigin()]);
  const areaId = raw ? Number(raw) : null;
  const shown = areas.filter((a) => areaId === null || a.id === areaId);
  const cards = await Promise.all(
    shown.flatMap((a) =>
      a.tables.map(async (t) => {
        const url = `${origin}/order?t=${t.id}`;
        return { id: t.id, name: t.name, areaName: a.name, url, img: await toDataURL(url, { width: 360, margin: 1 }) };
      }),
    ),
  );
  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="QR τραπεζιών"
        subtitle={
          settings.qrOrdering
            ? "Ένα QR για κάθε τραπέζι. Ο πελάτης παραγγέλνει από το τραπέζι του και η παραγγελία πηγαίνει στο ταμείο που έχει αναλάβει τον χώρο."
            : "Ένα QR για κάθε τραπέζι. Τώρα ανοίγει το μενού. Αν ανοίξουν οι παραγγελίες με online πληρωμή, τα ίδια QR θα δέχονται παραγγελίες από το τραπέζι χωρίς νέα εκτύπωση."
        }
        actions={
          <>
            <Link href="/admin/qr" className="btn-secondary btn-sm">
              ← QR & Παραλαβές
            </Link>
            <PrintButton disabled={cards.length === 0} />
          </>
        }
      />
      <nav aria-label="Χώροι" className="flex flex-wrap gap-2">
        <Link href="/admin/qr/tables" className={`chip ${areaId === null ? "bg-ink text-white" : "bg-surface-3 text-ink-2"}`}>
          Όλοι οι χώροι
        </Link>
        {areas.map((a) => (
          <Link key={a.id} href={`/admin/qr/tables?a=${a.id}`} className={`chip ${areaId === a.id ? "bg-ink text-white" : "bg-surface-3 text-ink-2"}`}>
            {a.name} · {a.tables.length}
          </Link>
        ))}
      </nav>
      <p className="text-xs text-ink-3">
        Τα QR δείχνουν στη διεύθυνση από την οποία άνοιξες αυτή τη σελίδα ({origin.replace(/^https?:\/\//, "")}). Τύπωσέ τα από τη δημόσια διεύθυνση του καταστήματος. Αν
        αλλάξεις όνομα σε τραπέζι το QR του μένει ίδιο· αν σβήσεις και ξαναφτιάξεις τραπέζι, τύπωσε νέο.
      </p>
      {cards.length === 0 ? (
        <div className="card p-6 text-center text-ink-2">Δεν υπάρχουν τραπέζια. Πρόσθεσέ τα από τη Διαχείριση → Χώροι & τραπέζια.</div>
      ) : (
        <div id="qr-sheet" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 print:grid-cols-3 print:gap-4">
          {cards.map((c) => (
            <div key={c.id} className="qr-card rounded-2xl border-2 border-dashed border-[#cfcfc8] bg-white text-[#16181d] p-4 text-center space-y-2 [&_*]:text-[#16181d]" data-testid={`table-qr-${c.id}`}>
              <div className="text-xs uppercase tracking-widest font-semibold">{settings.venueName}</div>
              <div className="text-3xl font-black tracking-tight leading-none">{c.name}</div>
              <div className="text-xs font-semibold">{c.areaName}</div>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
              <img src={c.img} alt={`QR τραπεζιού ${c.name}`} width={180} height={180} className="w-full max-w-[180px] aspect-square mx-auto" />
              <div className="text-sm font-semibold">{settings.qrOrdering ? "Σκάναρε & παράγγειλε" : "Σκάναρε για το μενού"}</div>
              <div className="text-[10px] leading-tight">{settings.qrOrdering ? "Πληρώνεις στο ταμείο" : "Παραγγελία στο ταμείο"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
