import { requirePageUser } from "@/server/page-auth";
import { daySummary, toShiftDto } from "@/server/services/registers";
import { todayAthens } from "@/server/services/reports";
import { RegistersView } from "./registers-view";

export const dynamic = "force-dynamic";

/** Ταμεία ημέρας: κάθε βάρδια κάθε ταμείου για μια ημέρα, με γενικό σύνολο. ?date=YYYY-MM-DD (προεπιλογή: σήμερα). */
export default async function RegistersDayPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const today = todayAthens();
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(raw + "T12:00:00Z").getTime()) ? raw : today;
  const day = await daySummary(date);
  return (
    <RegistersView
      today={today}
      day={{
        date: day.date,
        registers: day.registers.map((r) => ({ registerId: r.registerId, name: r.name, active: r.active, totals: r.totals, shifts: r.shifts.map((s) => ({ ...toShiftDto(s), carriedOver: s.carriedOver })) })),
        unassigned: day.unassigned,
        total: day.total,
        grandTotalCents: day.grandTotalCents,
      }}
    />
  );
}
