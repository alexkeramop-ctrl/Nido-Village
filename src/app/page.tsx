import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { homeFor } from "@/components/ops/home";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(homeFor(user.role));
}
