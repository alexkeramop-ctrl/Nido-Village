import { headers } from "next/headers";
import { requirePageUser } from "@/server/page-auth";
import { listPartnerUsers } from "@/server/services/partners";
import { PartnersManager } from "./partners-manager";

export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  await requirePageUser("admin");
  const [users, h] = await Promise.all([listPartnerUsers(), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host && /^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  const partnersUrl = host ? `${proto}://${host}/partners` : "/partners";
  return (
    <PartnersManager
      partnersUrl={partnersUrl}
      users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, active: u.active, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
    />
  );
}
