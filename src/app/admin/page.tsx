import Link from "next/link";
import { LiveRefresh } from "@/components/live";
import { WEEKDAYS_SHORT, monthLabel, weekdayMon } from "@/components/admin/events/dates";
import { EVENT_TYPE_DOT, SCOPES } from "@/components/admin/events/meta";
import { packageByKey } from "@/components/admin/events/party";
import { fmtIsoDate } from "@/components/admin/format";
import { requirePageUser } from "@/server/page-auth";
import { publisherStatus } from "@/server/cloud/publisher";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, upcomingEvents } from "@/server/services/events";
import { financeMonth } from "@/server/services/finance";
import { listIngredients } from "@/server/services/inventory";
import { listStations } from "@/server/services/printers";
import { listPickupBoard } from "@/server/services/public-order";
import { addDays, todayDashboard } from "@/server/services/reports";
import { formatEuro } from "@/server/money";

export const dynamic = "force-dynamic";

const eur = formatEuro;
const MONTHS_GEN = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];
const DAYS_FULL = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Καλημέρα" : h < 18 ? "Καλό απόγευμα" : "Καλησπέρα";
}

export default async function AdminOverviewPage() {
  const user = await requirePageUser("manager", "admin");
  const isAdmin = user.role === "admin";
  const [dash, ingredients, stations, events, pickup] = await Promise.all([todayDashboard(), listIngredients(), listStations(), upcomingEvents(30, 100), listPickupBoard()]);
  const fin = isAdmin ? await financeMonth(dash.today.slice(0, 7)) : null;
  const cloud = publisherStatus();
  const low = ingredients.filter((i) => i.low);
  const s = dash.summary;
  const parties = events.filter((e) => e.type === "party").slice(0, 5);
  const ceremonies = events.filter((e) => SCOPES.ceremonies.types.includes(e.type)).slice(0, 5);
  const printerIssues = stations.filter((st) => st.enabled && st.lastError);
  const [y, m, d] = dash.today.split("-").map(Number);
  const week = Array.from({ length: 7 }, (_, i) => addDays(dash.today, i - 6));
  const weekDays = fin ? week.map((iso) => ({ iso, cents: fin.days.find((x) => x.date === iso)?.income ?? 0 })) : [];
  const weekMax = Math.max(1, ...weekDays.map((w) => w.cents));
  const thisWeekend = events.filter((e) => e.date >= dash.today && e.date <= addDays(dash.today, 7) && e.status !== "cancelled");

  return (
    <div className="glass-page space-y-4">
      <LiveRefresh types={["session.changed", "stock.changed", "printer.status", "catalog.changed"]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="glass-label">
            {DAYS_FULL[weekdayMon(dash.today)]} {d} {MONTHS_GEN[m - 1]} {y}
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {greeting()}, {user.name} 👋
          </h1>
          <p className="text-sm text-ink-2 mt-1">
            {thisWeekend.length ? `${thisWeekend.length} κρατήσεις τις επόμενες 7 ημέρες.` : "Καμία κράτηση τις επόμενες 7 ημέρες."}
            {low.length ? ` ${low.length} είδη θέλουν παραγγελία.` : " Η αποθήκη είναι εντάξει."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/cashier" className="glass-btn">
            💶 Ταμείο
          </Link>
          <Link href="/admin/parties" className="glass-btn">
            🎂 Νέο πάρτι
          </Link>
          <Link href="/admin/ceremonies" className="glass-btn">
            💍 Γάμος / βάπτιση
          </Link>
          {isAdmin && (
            <Link href="/admin/finance" className="glass-btn-solid">
              + Έξοδο
            </Link>
          )}
        </div>
      </header>

      {/* Σήμερα */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Τζίρος σήμερα" value={eur(s.grossCents)} sub={`${s.sessions} λογαριασμοί · μέση ${eur(s.avgTicketCents)}`} hi />
        <Tile label="Ανοιχτά τραπέζια" value={String(dash.openSessions)} sub={`${eur(dash.openCents)} σε εξέλιξη`} accent={dash.openSessions ? "amber" : undefined} href="/pda" />
        <Tile label="Κουζίνα & μπαρ" value={String(dash.pendingKitchen)} sub="είδη σε αναμονή" accent={dash.pendingKitchen > 8 ? "rose" : undefined} href="/kds" />
        <Tile label="Παραγγελίες QR" value={String(pickup.length)} sub={pickup.length ? `${pickup.filter((p) => p.status === "ready").length} έτοιμες για παραλαβή` : "καμία σε αναμονή"} href="/admin/qr" accent={pickup.length ? "amber" : undefined} />
      </div>

      {/* Μήνας: έσοδα / έξοδα */}
      {fin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Link href="/admin/finance" className="glass p-4 lg:col-span-2 hover:bg-white/80 transition-colors">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="glass-label">{monthLabel(dash.today.slice(0, 7))} · αποτέλεσμα</div>
                <div className={`mt-1 text-4xl font-semibold num tracking-tight ${fin.net >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {fin.net >= 0 ? "+" : "−"}
                  {eur(Math.abs(fin.net))}
                </div>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="glass-label">Έσοδα</div>
                  <div className="num font-semibold text-emerald-700">{eur(fin.income.total)}</div>
                </div>
                <div>
                  <div className="glass-label">Έξοδα</div>
                  <div className="num font-semibold text-rose-600">{eur(fin.expense.total)}</div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-end gap-2 h-24">
              {weekDays.map((w) => (
                <div key={w.iso} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${fmtIsoDate(w.iso)} · ${eur(w.cents)}`}>
                  <div className="text-[10px] num text-ink-2">{w.cents ? Math.round(w.cents / 100) : ""}</div>
                  <div className="w-full max-w-10 rounded-lg bg-gradient-to-t from-emerald-400/70 to-teal-200/90" style={{ height: `${Math.max(4, (w.cents / weekMax) * 100)}%`, opacity: w.cents ? 1 : 0.25 }} />
                  <div className={`text-[10px] ${w.iso === dash.today ? "text-ink font-bold" : "text-ink-3"}`}>{WEEKDAYS_SHORT[weekdayMon(w.iso)]}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-ink-3">Έσοδα τελευταίων 7 ημερών (ταμείο + καταχωρημένα)</div>
          </Link>
          <div className="glass p-4">
            <div className="glass-label mb-3">Μεγαλύτερα έξοδα μήνα</div>
            {fin.expense.total ? (
              <ul className="space-y-2.5">
                {[...(fin.expense.purchases ? [{ category: "Αγορές αποθήκης", cents: fin.expense.purchases }] : []), ...fin.expense.manual]
                  .sort((a, b) => b.cents - a.cents)
                  .slice(0, 5)
                  .map((r) => (
                    <li key={r.category}>
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="truncate">{r.category}</span>
                        <span className="num">{eur(r.cents)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-black/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-200" style={{ width: `${(r.cents / fin.expense.total) * 100}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <div className="text-sm text-ink-3">
                Δεν έχουν περαστεί έξοδα. <Link href="/admin/finance" className="underline">Πέρασε τα πάγια</Link> για να βλέπεις το πραγματικό κέρδος.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ημερολόγια */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <EventList
          title="🎂 Επόμενα παιδικά πάρτι"
          href="/admin/parties"
          empty="Κανένα πάρτι τις επόμενες 30 ημέρες."
          items={parties.map((e) => ({
            id: e.id,
            date: e.date,
            time: e.startTime,
            title: e.party?.childName ? `${e.party.childName}${e.party.childAge ? ` · ${e.party.childAge} ετών` : ""}` : e.title,
            sub: [packageByKey(e.party?.package)?.name, e.party?.kids ? `${e.party.kids} παιδιά` : null, e.party?.cake ? `τούρτα: ${e.party.cake}` : null].filter(Boolean).join(" · "),
            dot: EVENT_TYPE_DOT[e.type],
            status: EVENT_STATUS_LABEL[e.status],
            confirmed: e.status === "confirmed",
          }))}
        />
        <EventList
          title="💍 Γάμοι, βαπτίσεις & ραντεβού"
          href="/admin/ceremonies"
          empty="Τίποτα τις επόμενες 30 ημέρες."
          items={ceremonies.map((e) => ({
            id: e.id,
            date: e.date,
            time: e.startTime,
            title: e.title,
            sub: [EVENT_TYPE_LABEL[e.type], e.type !== "appointment" && e.guests ? `${e.guests} καλεσμένοι` : null, e.customerPhone].filter(Boolean).join(" · "),
            dot: EVENT_TYPE_DOT[e.type],
            status: EVENT_STATUS_LABEL[e.status],
            confirmed: e.status === "confirmed",
          }))}
        />
      </div>

      {/* Λειτουργία */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="glass p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="glass-label">Αποθήκη · κάτω από το ελάχιστο</div>
            <Link href="/admin/inventory" className="text-xs text-ink-2 hover:text-ink">
              Αποθήκη →
            </Link>
          </div>
          {low.length ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {low.slice(0, 8).map((i) => {
                const pct = Math.max(0, Math.min(100, (Number(i.stock) / Math.max(0.001, Number(i.min))) * 100));
                return (
                  <li key={i.id}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{i.name}</span>
                      <span className="num text-rose-600">
                        {String(i.stock).replace(".", ",")} / {String(i.min).replace(".", ",")}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-black/5 overflow-hidden">
                      <div className="h-full rounded-full bg-rose-400" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-sm text-emerald-700">✓ Όλα τα είδη πάνω από το ελάχιστο απόθεμα.</div>
          )}
        </div>
        <div className="glass p-4 space-y-3">
          <div className="glass-label">Σύστημα</div>
          <Status ok={!printerIssues.length} label="Εκτυπωτές" detail={printerIssues.length ? printerIssues.map((p) => p.name).join(", ") : `${stations.filter((st) => st.enabled).length} σε λειτουργία`} href="/admin/printers" />
          <Status
            ok={!cloud.lastError}
            label="Συγχρονισμός cloud"
            detail={cloud.lastError ? "Σφάλμα" : cloud.url ? "Ενεργός" : "Μόνο τοπικά"}
            href="/admin/settings"
          />
          <Status ok label="Δεδομένα σήμερα" detail={`${s.covers} άτομα · εκπτώσεις ${eur(s.discountsCents)}`} href="/admin/reports" />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, hi, accent, href }: { label: string; value: string; sub: string; hi?: boolean; accent?: "amber" | "rose"; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <div className="glass-label">{label}</div>
        {accent && <span className={`h-2 w-2 rounded-full ${accent === "amber" ? "bg-amber-300" : "bg-rose-400"} animate-pulse`} />}
      </div>
      <div className="mt-1 text-3xl font-semibold num tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-ink-2 truncate">{sub}</div>
    </>
  );
  const cls = `${hi ? "glass-hi" : "glass"} p-4 block transition-colors hover:bg-white/80`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function EventList({
  title,
  href,
  empty,
  items,
}: {
  title: string;
  href: string;
  empty: string;
  items: { id: number; date: string; time: string; title: string; sub: string; dot: string; status: string; confirmed: boolean }[];
}) {
  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{title}</div>
        <Link href={href} className="text-xs text-ink-2 hover:text-ink">
          Ημερολόγιο →
        </Link>
      </div>
      {items.length ? (
        <ul className="divide-y divide-black/5">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <div className="w-12 shrink-0 rounded-xl bg-black/5 border border-white/80 text-center py-1">
                <div className="text-[10px] uppercase text-ink-2">{WEEKDAYS_SHORT[weekdayMon(e.date)]}</div>
                <div className="text-lg font-semibold leading-5 num">{Number(e.date.slice(8))}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  <span className={`inline-block h-2 w-2 rounded-full mr-1.5 align-middle ${e.dot}`} />
                  {e.title}
                </div>
                <div className="text-xs text-ink-2 truncate">
                  <span className="num">{e.time}</span>
                  {e.sub && ` · ${e.sub}`}
                </div>
              </div>
              <span className={`text-[11px] rounded-full px-2 py-0.5 border ${e.confirmed ? "border-emerald-600/30 text-emerald-700 bg-emerald-500/10" : "border-amber-600/30 text-amber-700 bg-amber-400/15"}`}>{e.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-3 py-2">{empty}</div>
      )}
    </div>
  );
}

function Status({ ok, label, detail, href }: { ok: boolean; label: string; detail: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl px-2 py-1.5 -mx-2 hover:bg-white/50">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500 shadow-[0_0_10px_#34d399]" : "bg-rose-500 shadow-[0_0_10px_#fb7185]"}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-ink-3 truncate">{detail}</div>
      </div>
    </Link>
  );
}
