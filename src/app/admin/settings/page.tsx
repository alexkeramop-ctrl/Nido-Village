import { Badge } from "@/components/ui";
import { InfoBox, PageHeader, Section } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/format";
import { requirePageUser } from "@/server/page-auth";
import { publisherStatus } from "@/server/cloud/publisher";
import { listVatRates } from "@/server/services/catalog";
import { getSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";
import { VatTable } from "./vat-table";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser("admin");
  const [settings, vatRates] = await Promise.all([getSettings(), listVatRates()]);
  const cloud = publisherStatus();
  const mode = process.env.NIDO_MODE === "cloud" ? "cloud" : "store";
  return (
    <div className="space-y-4">
      <PageHeader title="Ρυθμίσεις" subtitle="Στοιχεία καταστήματος, συντελεστές ΦΠΑ, σύνδεση cloud και φορολογικά." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <SettingsForm settings={settings} />
        <VatTable rates={vatRates.map((v) => ({ id: v.id, name: v.name, ratePct: Number(v.ratePct), mydataCategory: v.mydataCategory, active: v.active }))} />
        <Section title="Σύνδεση cloud">
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={!cloud.enabled ? "neutral" : cloud.lastError ? "danger" : cloud.url ? "ok" : "warn"}>
                {!cloud.enabled ? "Ανενεργός" : cloud.lastError ? "Σφάλμα" : cloud.url ? "Ενεργός" : "Μόνο τοπικά"}
              </Badge>
              <span className="text-ink-2">Λειτουργία: {mode === "cloud" ? "cloud (δέχεται δεδομένα)" : "κατάστημα (στέλνει δεδομένα)"}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-ink-3">Διεύθυνση</dt>
              <dd className="num break-all">{cloud.url ?? "—"}</dd>
              <dt className="text-ink-3">Τελευταία αποστολή</dt>
              <dd className="num">{fmtDateTime(cloud.lastSentAt)}</dd>
              <dt className="text-ink-3">Τελευταίο σφάλμα</dt>
              <dd className={cloud.lastError ? "text-danger" : ""}>{cloud.lastError ?? "—"}</dd>
            </dl>
            <InfoBox>
              Ρυθμίζεται με μεταβλητές περιβάλλοντος στον server του καταστήματος: <code>CLOUD_SYNC_URL</code> (διεύθυνση της cloud εγκατάστασης),{" "}
              <code>CLOUD_SYNC_KEY</code> (κοινό μυστικό κλειδί) και <code>NIDO_MODE</code> (<code>store</code> στο κατάστημα, <code>cloud</code> στο online). Οι αλλαγές
              απαιτούν επανεκκίνηση.
            </InfoBox>
          </div>
        </Section>
        <Section title="Φορολογικό">
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge>Πάροχος: κανένας (Φάση 1)</Badge>
            </div>
            <p className="text-ink-2">
              Δεν έχει συνδεθεί πάροχος ηλεκτρονικής τιμολόγησης (ΥΠΑΗΕΣ). Οι αποδείξεις καταγράφονται ως «δεν απαιτείται» και δεν εκδίδονται νόμιμα
              παραστατικά από το σύστημα. Όταν συνδεθεί πάροχος, τα παραστατικά θα εκδίδονται αυτόματα στο κλείσιμο κάθε λογαριασμού.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
