import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { AdminNav } from "@/components/admin/nav";
import { requirePageUser } from "@/server/page-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser("manager", "admin");
  return (
    <Shell user={user} active="/admin" title="Διαχείριση">
      <div className="flex-1 flex flex-col lg:flex-row">
        <AdminNav role={user.role} />
        <main className="flex-1 min-w-0 w-full max-w-7xl p-4 lg:p-6 print:p-0">{children}</main>
      </div>
    </Shell>
  );
}
