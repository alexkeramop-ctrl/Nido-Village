import { PageHeader, Section, TableWrap } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/format";
import { requirePageUser } from "@/server/page-auth";
import { listAudit } from "@/server/services/reports";
import { listEmployees } from "@/server/services/staff";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  discount: "Έκπτωση",
  payment: "Πληρωμή",
  print_bill: "Εκτύπωση λογαριασμού",
  void_item: "Ακύρωση είδους",
  cancel_session: "Ακύρωση λογαριασμού",
  cash_open: "Άνοιγμα ταμείου",
  cash_close: "Κλείσιμο ταμείου",
  goods_receipt: "Παραλαβή",
  waste: "Φύρα",
  stock_adjust: "Διόρθωση αποθέματος",
  stock_count: "Απογραφή",
};
const ENTITY_LABEL: Record<string, string> = {
  table_session: "Λογαριασμός",
  order_item: "Είδος παραγγελίας",
  order: "Παραγγελία",
  cash_session: "Βάρδια ταμείου",
  goods_receipt: "Παραλαβή",
  ingredient: "Πρώτη ύλη",
  product: "Είδος",
  employee: "Υπάλληλος",
};

export default async function AuditPage() {
  await requirePageUser("manager", "admin");
  const [rows, employees] = await Promise.all([listAudit(200), listEmployees(true)]);
  const names = new Map(employees.map((e) => [e.id, e.name]));
  return (
    <div className="space-y-4">
      <PageHeader title="Ιστορικό ενεργειών" subtitle="Οι τελευταίες 200 καταγραφές: εκπτώσεις, ακυρώσεις, πληρωμές, ταμείο, αποθήκη." />
      <Section flush>
        {rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Ώρα</th>
                <th>Υπάλληλος</th>
                <th>Ενέργεια</th>
                <th>Οντότητα</th>
                <th className="text-right">ID</th>
                <th>Λεπτομέρειες</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const details = r.details ? JSON.stringify(r.details) : "";
                return (
                  <tr key={r.id}>
                    <td className="num text-ink-3 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td className="font-medium">
                      {r.employeeId === null ? <span className="text-ink-3">σύστημα</span> : (names.get(r.employeeId) ?? `#${r.employeeId}`)}
                      {r.employeeId !== null && <span className="text-xs text-ink-3 num"> #{r.employeeId}</span>}
                    </td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td className="text-ink-2">{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                    <td className="text-right num text-ink-2">{r.entityId ?? "—"}</td>
                    <td className="max-w-md">
                      <code className="block text-xs text-ink-2 truncate" title={details}>
                        {details || "—"}
                      </code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-4 text-sm text-ink-3">Δεν υπάρχουν καταγραφές ακόμη.</div>
        )}
      </Section>
    </div>
  );
}
