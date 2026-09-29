"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, EmptyState, Money } from "@/components/ui";
import { InfoBox, PageHeader, Section, TableWrap, useActionRunner } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/format";
import { QR_STATUS_LABEL, QR_STATUS_TONE } from "@/components/qr/labels";
import type { PublicOrderStatus } from "@/server/services/public-order";
import { markPickedUpAction } from "./actions";

export type QrOrderRow = {
  sessionId: number;
  code: string;
  customerName: string;
  customerPhone: string | null;
  status: PublicOrderStatus;
  openedAt: string;
  totalCents: number;
};

const PRINT_CSS = `
@media print {
  html, body { height: 100vh; overflow: hidden; background: #fff; }
  body * { visibility: hidden; }
  #qr-tent, #qr-tent * { visibility: visible; }
  #qr-tent { position: fixed; inset: 0; margin: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 0; box-shadow: none; border-radius: 0; background: #fff; }
}
`;

/** Η διεύθυνση χωρίς πρωτόκολλο, όπως θα την διαβάσει κάποιος από το χαρτί. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function QrClient({ venueName, orderUrl, pickupUrl, qrDataUrl, orders }: { venueName: string; orderUrl: string; pickupUrl: string; qrDataUrl: string; orders: QrOrderRow[] }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      toast("Αντιγράφηκε");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast("Δεν ήταν δυνατή η αντιγραφή", "danger");
    }
  };

  const pickedUp = (row: QrOrderRow) => run(() => markPickedUpAction(row.sessionId), { success: `Η #${row.code} σημειώθηκε ως παραδοθείσα` });

  return (
    <div className="space-y-4">
      {toastElement}
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="QR & Παραλαβές"
        subtitle="Οι πελάτες σκανάρουν το QR, παραγγέλνουν από το κινητό τους και πληρώνουν στο ταμείο όταν παραλάβουν."
        actions={
          <>
            <a href={qrDataUrl} download="nido-qr-order.png" className="btn-secondary btn-sm">
              Λήψη PNG
            </a>
            <button type="button" className="btn-primary btn-sm" onClick={() => window.print()}>
              Εκτύπωση
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="QR παραγγελίας">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL, δεν χρειάζεται βελτιστοποίηση */}
            <img src={qrDataUrl} alt={`QR για ${orderUrl}`} width={192} height={192} className="w-48 h-48 rounded-xl border border-line bg-white shrink-0" data-testid="qr-image" />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <div className="label">Σύνδεσμος παραγγελίας</div>
                <code className="block break-all rounded-lg bg-surface-3 px-3 py-2 text-sm">{orderUrl}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => copy(orderUrl)}>
                  {copied === orderUrl ? "✓ Αντιγράφηκε" : "Αντιγραφή"}
                </button>
                <Link href="/order" target="_blank" className="btn-secondary btn-sm">
                  Άνοιγμα σε νέα καρτέλα ↗
                </Link>
              </div>
              <p className="text-xs text-ink-3">
                Το QR δείχνει στη διεύθυνση από την οποία άνοιξες αυτή τη σελίδα. Αν οι πελάτες θα μπαίνουν από άλλη διεύθυνση (π.χ. δημόσιο domain), άνοιξε τη διαχείριση από
                εκείνη τη διεύθυνση πριν την εκτύπωση.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Οθόνη παραλαβών">
          <div className="space-y-3">
            <div>
              <div className="label">Σύνδεσμος πίνακα</div>
              <code className="block break-all rounded-lg bg-surface-3 px-3 py-2 text-sm">{pickupUrl}</code>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => copy(pickupUrl)}>
                {copied === pickupUrl ? "✓ Αντιγράφηκε" : "Αντιγραφή"}
              </button>
              <Link href="/pickup" target="_blank" className="btn-secondary btn-sm">
                Άνοιγμα πίνακα ↗
              </Link>
            </div>
            <InfoBox>
              Άνοιξέ τον σε μια οθόνη ή TV στο ταμείο (πλήρης οθόνη με F11). Δείχνει τους κωδικούς που ετοιμάζονται και όσους είναι έτοιμοι για παραλαβή, χωρίς σύνδεση χρήστη, και
              ανανεώνεται αυτόματα.
            </InfoBox>
          </div>
        </Section>
      </div>

      <Section title="Καρτέλα για το τραπέζι / ταμείο" actions={<span className="text-xs text-ink-3">Προεπισκόπηση εκτύπωσης · «Εκτύπωση» τυπώνει μόνο αυτό</span>}>
        <div id="qr-tent" className="mx-auto max-w-sm rounded-2xl border-2 border-dashed border-line bg-white text-ink p-8 text-center space-y-4">
          <div className="text-3xl font-black tracking-tight">{venueName}</div>
          <div className="text-lg font-semibold">Σκάναρε για παραγγελία take away</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
          <img src={qrDataUrl} alt="" width={256} height={256} className="w-64 h-64 mx-auto" />
          <div className="text-base font-mono break-all">{shortUrl(orderUrl)}</div>
          <div className="text-sm text-ink-2">Παραγγέλνεις από το κινητό σου · Πληρώνεις στο ταμείο όταν παραλάβεις</div>
        </div>
      </Section>

      <Section title="Πρόσφατες παραγγελίες QR" flush actions={<span className="text-xs text-ink-3 num">{orders.length}</span>}>
        {orders.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Καμία παραγγελία QR ακόμη" hint="Μόλις κάποιος πελάτης παραγγείλει από το QR, θα εμφανιστεί εδώ." />
          </div>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Κωδικός</th>
                <th>Όνομα</th>
                <th>Τηλέφωνο</th>
                <th>Κατάσταση</th>
                <th>Ώρα</th>
                <th className="text-right">Σύνολο</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const open = o.status === "received" || o.status === "preparing" || o.status === "ready";
                return (
                  <tr key={o.sessionId} data-testid={`qr-order-${o.code}`}>
                    <td className="font-bold num">#{o.code}</td>
                    <td>{o.customerName || "—"}</td>
                    <td className="num">{o.customerPhone || "—"}</td>
                    <td>
                      <Badge tone={QR_STATUS_TONE[o.status]}>{QR_STATUS_LABEL[o.status]}</Badge>
                    </td>
                    <td className="num whitespace-nowrap">{fmtDateTime(o.openedAt)}</td>
                    <td className="text-right">
                      <Money cents={o.totalCents} className="font-semibold" />
                    </td>
                    <td className="text-right">
                      {open && (
                        <button type="button" className="btn-secondary btn-sm whitespace-nowrap" disabled={pending} onClick={() => pickedUp(o)}>
                          Παραδόθηκε
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
