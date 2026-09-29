import { requirePageUser } from "@/server/page-auth";
import { addDays, salesByCategory, salesByEmployee, salesByProduct, salesSummary, todayAthens } from "@/server/services/reports";
import { ReportsView } from "./reports-view";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const today = todayAthens();
  const fromParam = one(sp.from);
  const toParam = one(sp.to);
  let to = toParam && ISO_DATE.test(toParam) ? toParam : today;
  let from = fromParam && ISO_DATE.test(fromParam) ? fromParam : to;
  if (from > to) [from, to] = [to, from];
  if (addDays(from, 366) < to) from = addDays(to, -366);
  const range = { from, to };
  const [summary, byProduct, byCategory, byEmployee] = await Promise.all([salesSummary(range), salesByProduct(range), salesByCategory(range), salesByEmployee(range)]);
  const presets = [
    { label: "Σήμερα", from: today, to: today },
    { label: "Χθες", from: addDays(today, -1), to: addDays(today, -1) },
    { label: "7 ημέρες", from: addDays(today, -6), to: today },
    { label: "30 ημέρες", from: addDays(today, -29), to: today },
    { label: "Μήνας", from: today.slice(0, 8) + "01", to: today },
  ];
  return (
    <ReportsView
      from={from}
      to={to}
      presets={presets}
      summary={{
        sessions: summary.sessions,
        grossCents: summary.grossCents,
        discountsCents: summary.discountsCents,
        avgTicketCents: summary.avgTicketCents,
        covers: summary.covers,
        perCoverCents: summary.perCoverCents,
        byMethod: summary.byMethod,
        byDay: summary.byDay,
        byHour: summary.byHour,
        vat: summary.vat,
        voidsCents: summary.voidsCents,
        voidsCount: summary.voidsCount,
      }}
      byProduct={byProduct}
      byCategory={byCategory}
      byEmployee={byEmployee}
    />
  );
}
