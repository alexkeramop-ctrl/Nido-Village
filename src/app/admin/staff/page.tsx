import { requirePageUser } from "@/server/page-auth";
import { listEmployees, ROLE_LABEL } from "@/server/services/staff";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const user = await requirePageUser("admin");
  const employees = await listEmployees(true);
  return (
    <StaffManager
      currentUserId={user.id}
      employees={employees.map((e) => ({ id: e.id, name: e.name, role: e.role, active: e.active, createdAt: e.createdAt.toISOString() }))}
      roles={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))}
    />
  );
}
