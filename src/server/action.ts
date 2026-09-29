/** Τυποποιημένο αποτέλεσμα server actions ώστε το UI να δείχνει καθαρά μηνύματα. */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Κάτι πήγε στραβά";
    return { ok: false, error: message };
  }
}
