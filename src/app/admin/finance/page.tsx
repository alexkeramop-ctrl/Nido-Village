import { requirePageUser } from "@/server/page-auth";
import { financeMonth, financeYear, unpaidInvoices } from "@/server/services/finance";
import { listSuppliers } from "@/server/services/inventory";
import { invoiceFeatures } from "@/server/services/invoice-files";
import { todayAthens } from "@/server/services/reports";
import { MONTH_RE } from "@/components/admin/events/dates";
import { FinanceView } from "./finance-view";

export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("admin");
  const sp = await searchParams;
  const today = todayAthens();
  const raw = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const month = raw && MONTH_RE.test(raw) ? raw : today.slice(0, 7);
  const [data, year, suppliers, unpaid, features] = await Promise.all([financeMonth(month), financeYear(month), listSuppliers(), unpaidInvoices(today), invoiceFeatures()]);
  return (
    <FinanceView
      data={data}
      year={year}
      today={today}
      unpaid={unpaid}
      features={features}
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, vatNumber: s.vatNumber }))}
    />
  );
}
