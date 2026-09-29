import { redirect } from "next/navigation";
import { getPartnerSession } from "@/server/services/partners";
import { computeSnapshot, getDailyHistory, getLatestSnapshot, type Snapshot } from "@/server/cloud/snapshot";
import { PartnersDashboard } from "./dashboard";
import { partnerLogoutAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Online dashboard συνεταίρων (μόνο ανάγνωση).
 * Δείχνει το τελευταίο snapshot που έστειλε το κατάστημα. Αν τρέχει στην ίδια βάση με το ταμείο
 * και δεν υπάρχει snapshot, υπολογίζει ζωντανά.
 */
export default async function PartnersPage() {
  const partner = await getPartnerSession();
  if (!partner) redirect("/partners/login");
  let snapshot: Snapshot;
  let receivedAt: Date;
  let source: "sync" | "live";
  const latest = await getLatestSnapshot();
  if (latest) {
    snapshot = latest.snapshot;
    receivedAt = latest.receivedAt;
    source = "sync";
  } else {
    snapshot = await computeSnapshot();
    receivedAt = new Date();
    source = "live";
  }
  const history = await getDailyHistory(90);
  return (
    <main className="min-h-full flex-1 bg-dark text-white">
      <header className="sticky top-0 z-30 bg-dark-2 border-b border-dark-3">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center gap-3">
          <span className="font-bold text-brand">Nido</span>
          <span className="text-slate-200 font-semibold truncate">{snapshot.venueName}</span>
          <span className="ml-auto text-xs text-slate-400 hidden sm:inline">{partner.name}</span>
          <form action={partnerLogoutAction}>
            <button className="text-sm text-slate-300 hover:text-white px-2 py-1">Έξοδος</button>
          </form>
        </div>
      </header>
      <PartnersDashboard
        snapshot={snapshot}
        receivedAt={receivedAt.toISOString()}
        source={source}
        history={history.map((h) => ({ day: h.day, grossCents: h.summary.grossCents, sessions: h.summary.sessions }))}
      />
    </main>
  );
}
