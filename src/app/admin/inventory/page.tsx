import Link from "next/link";
import { LiveRefresh } from "@/components/live";
import { PageHeader } from "@/components/admin/common";
import { requirePageUser } from "@/server/page-auth";
import {
  consumptionReport,
  listGoodsReceipts,
  listIngredients,
  listMovements,
  listSuppliers,
  MOVEMENT_LABEL,
  UNIT_LABEL,
} from "@/server/services/inventory";
import { addDays, athensDayStart, todayAthens } from "@/server/services/reports";
import { StockTab } from "./stock-tab";
import { ReceiveTab } from "./receive-tab";
import { CountTab } from "./count-tab";
import { MovementsTab } from "./movements-tab";
import { SuppliersTab } from "./suppliers-tab";
import { ConsumptionTab } from "./consumption-tab";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "stock", label: "Απόθεμα" },
  { key: "receive", label: "Παραλαβή" },
  { key: "count", label: "Απογραφή" },
  { key: "movements", label: "Κινήσεις" },
  { key: "suppliers", label: "Προμηθευτές" },
  { key: "consumption", label: "Κατανάλωση" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("manager", "admin");
  const sp = await searchParams;
  const requested = one(sp.tab);
  const tab: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : "stock";

  const [ingredientsRaw, suppliersRaw] = await Promise.all([listIngredients(true), listSuppliers(true)]);
  const ingredients = ingredientsRaw.map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    unitLabel: UNIT_LABEL[i.unit],
    stock: i.stock,
    min: i.min,
    cost: i.cost,
    low: i.low,
    stockValueCents: i.stockValueCents,
    supplierId: i.supplierId,
    supplierName: i.supplier?.name ?? null,
    active: i.active,
  }));
  const suppliers = suppliersRaw.map((s) => ({ id: s.id, name: s.name, vatNumber: s.vatNumber, phone: s.phone, email: s.email, notes: s.notes, active: s.active }));
  const units = Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label }));
  const today = todayAthens();

  let content: React.ReactNode;
  if (tab === "stock") {
    content = <StockTab ingredients={ingredients} suppliers={suppliers} units={units} />;
  } else if (tab === "receive") {
    const receipts = await listGoodsReceipts(30);
    content = (
      <ReceiveTab
        ingredients={ingredients}
        suppliers={suppliers}
        today={today}
        receipts={receipts.map((r) => ({
          id: r.id,
          supplierName: r.supplier?.name ?? null,
          docNumber: r.docNumber,
          docDate: r.docDate.toISOString(),
          totalCents: r.totalCents,
          notes: r.notes,
          lines: r.lines.map((l) => ({ id: l.id, ingredientName: l.ingredient.name, unitLabel: UNIT_LABEL[l.ingredient.unit], qty: Number(l.qty), unitCost: Number(l.unitCost) })),
        }))}
      />
    );
  } else if (tab === "count") {
    content = <CountTab ingredients={ingredients.filter((i) => i.active)} />;
  } else if (tab === "movements") {
    const ingredientParam = Number(one(sp.ingredient));
    const ingredientId = Number.isInteger(ingredientParam) && ingredientParam > 0 ? ingredientParam : undefined;
    const movements = await listMovements({ ingredientId, limit: 200 });
    content = (
      <MovementsTab
        ingredients={ingredients}
        selectedIngredientId={ingredientId ?? null}
        movements={movements.map((m) => ({
          id: m.id,
          ingredientName: m.ingredient.name,
          unitLabel: UNIT_LABEL[m.ingredient.unit],
          kind: m.kind,
          kindLabel: MOVEMENT_LABEL[m.kind],
          qtyDelta: Number(m.qtyDelta),
          unitCost: m.unitCost === null ? null : Number(m.unitCost),
          refType: m.refType,
          refId: m.refId,
          note: m.note,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    );
  } else if (tab === "suppliers") {
    content = <SuppliersTab suppliers={suppliers} />;
  } else {
    const fromParam = one(sp.from);
    const toParam = one(sp.to);
    const to = toParam && ISO_DATE.test(toParam) ? toParam : today;
    const from = fromParam && ISO_DATE.test(fromParam) ? fromParam : addDays(to, -29);
    const rows = await consumptionReport(athensDayStart(from), athensDayStart(addDays(to, 1)));
    content = (
      <ConsumptionTab
        from={from}
        to={to}
        rows={rows.map((r) => ({
          ingredientId: r.ingredient.id,
          name: r.ingredient.name,
          unitLabel: UNIT_LABEL[r.ingredient.unit],
          cost: r.ingredient.cost,
          purchased: r.purchased,
          sold: r.sold,
          waste: r.waste,
          countDiff: r.countDiff,
        }))}
      />
    );
  }

  return (
    <div className="space-y-4">
      <LiveRefresh types={["stock.changed"]} />
      <PageHeader title="Αποθήκη" subtitle="Πρώτες ύλες, παραλαβές, απογραφές και κινήσεις αποθέματος." />
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Ενότητες αποθήκης">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/admin/inventory", query: { tab: t.key } }}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              t.key === tab ? "border-brand text-brand-2" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {content}
    </div>
  );
}
