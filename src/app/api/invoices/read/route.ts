import { getSessionUser, hasRole } from "@/server/auth";
import { fileFromForm, readInvoiceFile } from "@/server/services/invoice-files";
import { InvoiceAiError } from "@/server/services/invoice-ai";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** «Ανάγνωση τιμολογίου» (μόνο διαχειριστής): επιστρέφει προτάσεις για τη φόρμα. Δεν αποθηκεύει τίποτα. multipart: file. */
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return fail(401, "Η σύνδεσή σου έληξε. Συνδέσου ξανά σε νέα καρτέλα — ό,τι έγραψες μένει στη φόρμα.");
  if (!hasRole(me, "admin")) return fail(403, "Δεν έχεις δικαίωμα για αυτή την ενέργεια");
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return fail(400, "Το αρχείο δεν έφτασε ολόκληρο. Έλεγξε τη σύνδεση και δοκίμασε ξανά.");
  }
  try {
    const bytes = await fileFromForm(fd);
    return Response.json({ ok: true, data: await readInvoiceFile({ bytes }) });
  } catch (e) {
    return fail(e instanceof InvoiceAiError ? 502 : 400, e instanceof Error ? e.message : "Η ανάγνωση απέτυχε");
  }
}
