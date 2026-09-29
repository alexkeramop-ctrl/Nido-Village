import { redirect } from "next/navigation";
import { getSessionUser, hasRole, type SessionUser } from "./auth";
import type { EmployeeRole } from "@/db/schema";

/** Για server pages: επιστρέφει τον χρήστη ή κάνει redirect στο login / αρχική. */
export async function requirePageUser(...roles: EmployeeRole[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (roles.length && !hasRole(user, ...roles)) redirect("/");
  return user;
}
