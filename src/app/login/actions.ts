"use server";
import { redirect } from "next/navigation";
import { clearSessionCookie, loginWithPin, setSessionCookie } from "@/server/auth";
import type { ActionResult } from "@/server/action";
import { homeFor } from "@/components/ops/home";

export async function loginAction(pin: string, next?: string): Promise<ActionResult> {
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: "Δώσε PIN 4 έως 8 ψηφίων" };
  const user = await loginWithPin(pin);
  if (!user) return { ok: false, error: "Λάθος PIN" };
  await setSessionCookie(user);
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : homeFor(user.role);
  redirect(target);
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
