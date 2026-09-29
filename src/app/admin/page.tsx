import Link from "next/link";
import { Badge, Money, Stat } from "@/components/ui";
import { LiveRefresh } from "@/components/live";
import { InfoBox, PageHeader, Section } from "@/components/admin/common";
import { fmtDateTime, fmtIsoDate } from "@/components/admin/format";
import { WEEKDAYS_SHORT, weekdayMon } from "@/components/admin/events/dates";
import { EVENT_STATUS_TONE, EVENT_TYPE_DOT } from "@/components/admin/events/meta";
import { requirePageUser } from "@/server/page-auth";
import { publisherStatus } from "@/server/cloud/publisher";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, upcomingEvents } from "@/server/services/events";
import { listIngredients } from "@/server/services/inventory";
import { listStations } from "@/server/services/printers";
import { todayDashboard } from "@/server/services/reports";

export const dynamic = "force-dynamic";

const QUICK_LINKS = [
  { href: "/admin/menu", label: "Μενού", hint: "Κατηγορίες, είδη, τιμές" },
  { href: "/admin/tables", label: "Τραπέζια", hint: "Χώροι και τραπέζια" },
  { href: "/admin/inventory", label: "Αποθήκη", hint: "Απόθεμα, παραλαβές, απογραφή" },
  { href: "/admin/reports", label: "Αναφορές", hint: "Πωλήσεις ανά ημέρα, είδος, σερβιτόρο" },
  { href: "/admin/printers", label: "Εκτυπωτές", hint: "Σταθμοί και ουρά εκτύπωσης" },
  { href: "/admin/audit", label: "Ιστορικό", hint: "Ενέργειες προσωπικού" },
];

export default async function AdminOverviewPage() {
  const user = await requirePageUser("manager", "admin");
  const [dash, ingredients, stations, events] = await Promise.all([todayDashboard(), listIngredients(), listStations(), upcomingEvents(14, 5)]);
  const cloud = publisherStatus();
  const low = ingredients.filter((i) => i.low);
  const s = dash.summary;

  return (
    <div className="space-y-5">
      <LiveRefresh types={["session.changed", "stock.changed", "printer.status"]} />
      <PageHeader title="Επισκόπηση" subtitle={`Καλώς ήρθες, ${user.name}. Σήμερα ${dash.today.split("-").reverse().join("/")}.`} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Τζίρος σήμερα" value={<Money cents={s.grossCents} />} sub={`${s.sessions} λογαριασμοί`} />
        <Stat label="Μέση απόδειξη" value={<Money cents={s.avgTicketCents} />} sub={`${s.covers} άτομα`} />
        <Stat label="Ανοιχτά τραπέζια" value={dash.openSessions} sub={<Money cents={dash.openCents} />} tone={dash.openSessions ? "warn" : undefined} />
        <Stat label="Στην κουζίνα" value={dash.pendingKitchen} sub="είδη σε εκκρεμότητα" />
        <Stat label="Εκπτώσεις" value={<Money cents={s.discountsCents} />} sub={`${s.voidsCount} ακυρώσεις`} />
        <Stat label="Χαμηλό απόθεμα" value={low.length} sub={low.length ? "είδη κάτω από το ελάχιστο" : "όλα εντάξει"} tone={low.length ? "danger" : "ok"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Εκτυπωτές" actions={<Link href="/admin/printers" className="btn-ghost btn-sm">Διαχείριση</Link>} flush>
          {stations.length ? (
            <ul className="divide-y divide-line">
              {stations.map((st) => {
                const ok = st.enabled && !st.lastError;
                return (
                  <li key={st.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{st.name}</div>
                      <div className="text-xs text-ink-3 truncate">
                        {st.driver === "tcp" ? `${st.host ?? "—"}:${st.port}` : "console"} · τελευταία επιτυχία: {fmtDateTime(st.lastOkAt)}
                        {st.lastError && <span className="text-danger"> · {st.lastError}</span>}
                      </div>
                    </div>
                    <Badge tone={!st.enabled ? "neutral" : ok ? "ok" : "danger"}>{!st.enabled ? "Ανενεργός" : ok ? "OK" : "Σφάλμα"}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4 text-sm text-ink-3">Δεν έχουν οριστεί σταθμοί εκτύπωσης.</div>
          )}
        </Section>

        <Section title="Συγχρονισμός cloud">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={!cloud.enabled ? "neutral" : cloud.lastError ? "danger" : cloud.url ? "ok" : "warn"}>
                {!cloud.enabled ? "Ανενεργός" : cloud.lastError ? "Σφάλμα" : cloud.url ? "Ενεργός" : "Μόνο τοπικά"}
              </Badge>
              <span className="text-sm text-ink-2">{cloud.url ? cloud.url : "Δεν έχει οριστεί διεύθυνση cloud"}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">Τελευταία αποστολή</dt>
              <dd className="num">{fmtDateTime(cloud.lastSentAt)}</dd>
              <dt className="text-ink-3">Τελευταίο σφάλμα</dt>
              <dd className={cloud.lastError ? "text-danger" : ""}>{cloud.lastError ?? "–"}</dd>
            </dl>
            <InfoBox>
              Το κατάστημα υπολογίζει κάθε λίγα λεπτά ένα στιγμιότυπο στατιστικών και, αν έχει οριστεί <code>CLOUD_SYNC_URL</code>, το στέλνει
              στο cloud ώστε οι συνεταίροι να βλέπουν τα στοιχεία online. Χωρίς διεύθυνση, το στιγμιότυπο αποθηκεύεται μόνο τοπικά.
            </InfoBox>
          </div>
        </Section>
      </div>

      <Section title="Επόμενες εκδηλώσεις" actions={<Link href="/admin/events" className="btn-ghost btn-sm">Ημερολόγιο</Link>} flush>
        {events.length ? (
          <ul className="divide-y divide-line" data-testid="overview-events">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-28 shrink-0">
                  <div className="font-semibold num text-sm">
                    {WEEKDAYS_SHORT[weekdayMon(ev.date)]} {fmtIsoDate(ev.date)}
                  </div>
                  <div className="text-xs text-ink-3 num">
                    {ev.startTime}–{ev.endTime}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{ev.title}</div>
                  <div className="text-xs text-ink-3 truncate">
                    <span className={`inline-block h-2 w-2 rounded-full mr-1 align-middle ${EVENT_TYPE_DOT[ev.type]}`} />
                    {EVENT_TYPE_LABEL[ev.type]} · <span className="num">{ev.guests} άτομα</span>
                    {ev.area && ` · ${ev.area.name}`}
                  </div>
                </div>
                <Badge tone={EVENT_STATUS_TONE[ev.status]}>{EVENT_STATUS_LABEL[ev.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν εκδηλώσεις τις επόμενες 14 ημέρες.</div>
        )}
      </Section>

      {low.length > 0 && (
        <Section title="Είδη κάτω από το ελάχιστο απόθεμα" actions={<Link href="/admin/inventory" className="btn-ghost btn-sm">Αποθήκη</Link>} flush>
          <ul className="divide-y divide-line">
            {low.slice(0, 8).map((i) => (
              <li key={i.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>{i.name}</span>
                <span className="num text-danger">
                  {String(i.stock).replace(".", ",")} / ελάχ. {String(i.min).replace(".", ",")}
                </span>
              </li>
            ))}
            {low.length > 8 && <li className="px-4 py-2 text-xs text-ink-3">και {low.length - 8} ακόμη…</li>}
          </ul>
        </Section>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className="card p-4 hover:border-brand transition-colors">
            <div className="font-semibold">{q.label}</div>
            <div className="text-xs text-ink-3 mt-0.5">{q.hint}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
