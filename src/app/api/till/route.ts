import { getSessionUser, hasRole } from "@/server/auth";
import { tillSnapshot } from "@/server/services/till";

export const dynamic = "force-dynamic";

/**
 * Στιγμιότυπο για το ταμείο (εκκρεμείς παραγγελίες, έτοιμες, σύνολα βάρδιας, εξαντλημένα είδη).
 * Είναι GET και όχι server action επειδή το Next εκτελεί τα actions ένα-ένα: μια ανανέωση στο παρασκήνιο
 * δεν πρέπει ποτέ να καθυστερεί την επόμενη πώληση.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !hasRole(user, "cashier", "manager")) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("register"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "bad register" }, { status: 400 });
  return Response.json(await tillSnapshot(id), { headers: { "Cache-Control": "no-store" } });
}
