import { getSessionUser, hasRole } from "@/server/auth";
import { fileFromForm, uploadInvoiceFile } from "@/server/services/invoice-files";
import { DriveError } from "@/server/services/google-drive";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string, code?: string) => Response.json({ ok: false, error, ...(code ? { code } : {}) }, { status });

/** Ανεβάζει το συνημμένο ενός τιμολογίου στο Google Drive (μόνο διαχειριστής). multipart: file, date, supplier, docNumber. */
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return fail(401, "Η σύνδεσή σου έληξε. Άνοιξε νέα καρτέλα, συνδέσου ξανά και πάτησε πάλι Αποθήκευση — ό,τι έγραψες μένει στη φόρμα.");
  if (!hasRole(me, "admin")) return fail(403, "Δεν έχεις δικαίωμα για αυτή την ενέργεια");
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return fail(400, "Το αρχείο δεν έφτασε ολόκληρο. Έλεγξε τη σύνδεση και δοκίμασε ξανά.");
  }
  try {
    const bytes = await fileFromForm(fd);
    const str = (k: string) => String(fd.get(k) ?? "").trim();
    const file = await uploadInvoiceFile({ bytes, date: str("date"), supplier: str("supplier"), docNumber: str("docNumber") }, me.id);
    return Response.json({ ok: true, data: file });
  } catch (e) {
    if (e instanceof DriveError) return fail(e.code === "network" || e.code === "api" || e.code === "quota" ? 502 : 409, e.message, e.code);
    return fail(400, e instanceof Error ? e.message : "Το ανέβασμα απέτυχε");
  }
}
