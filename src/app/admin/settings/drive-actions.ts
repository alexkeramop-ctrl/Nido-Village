"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { getDb } from "@/db";
import { audit } from "@/server/audit";
import { disconnectDrive, testDriveUpload } from "@/server/services/google-drive";

function revalidate() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/finance");
}

/** «Αποσύνδεση»: ανακαλεί την άδεια στη Google και σβήνει το αποθηκευμένο (κρυπτογραφημένο) κλειδί. Τα αρχεία μένουν στο Drive. */
export async function disconnectDriveAction() {
  return run(async () => {
    const me = await requireRole("admin");
    await disconnectDrive(me.id);
    revalidate();
  });
}

/** «Δοκιμαστικό ανέβασμα»: μικρό αρχείο κειμένου στον φάκελο «Nido Τιμολόγια». Επιστρέφει όνομα και σύνδεσμο. */
export async function testDriveUploadAction() {
  return run(async () => {
    const me = await requireRole("admin");
    try {
      const file = await testDriveUpload();
      await audit(await getDb(), me.id, "drive_test_upload", "drive_file", null, { name: file.name });
      return { name: file.name, url: file.url };
    } finally {
      // Η κατάσταση της σύνδεσης μπορεί να άλλαξε (π.χ. «χρειάζεται επανασύνδεση»).
      revalidate();
    }
  });
}
