import { requirePageUser } from "@/server/page-auth";
import { LiveRefresh } from "@/components/live";
import { costingOverview, type CostBasis } from "@/server/services/costing";
import { CostingView } from "./costing-view";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Κοστολόγηση καταλόγου: food cost / drink cost ανά προϊόν, από συνταγές και τιμές τιμολογίων (Παραλαβές). */
export default async function CostingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const basis: CostBasis = one(sp.b) === "average" ? "average" : "last";
  const data = await costingOverview(basis);
  return (
    <>
      <LiveRefresh types={["stock.changed", "catalog.changed"]} />
      <CostingView data={data} />
    </>
  );
}
