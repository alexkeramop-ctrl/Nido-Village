"use server";
import { redirect } from "next/navigation";
import { clearPartnerCookie, partnerLogin, setPartnerCookie } from "@/server/services/partners";
import type { ActionResult } from "@/server/action";

export async function partnerLoginAction(email: string, password: string): Promise<ActionResult> {
  const p = await partnerLogin(email, password);
  if (!p) return { ok: false, error: "Λάθος email ή κωδικός" };
  await setPartnerCookie(p);
  redirect("/partners");
}

export async function partnerLogoutAction() {
  await clearPartnerCookie();
  redirect("/partners/login");
}
