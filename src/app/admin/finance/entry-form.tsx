"use client";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { Field } from "@/components/ui";
import { FormModal, InfoBox, Toggle, formValues, type useActionRunner } from "@/components/admin/common";
import { DateGR } from "@/components/admin/date-gr";
import { centsToInput, fmtIsoDate } from "@/components/admin/format";
import { addDaysIso } from "@/components/admin/events/dates";
import { EXPENSE_CATEGORIES, FINANCE_METHOD_LABEL, INCOME_CATEGORIES, type FinanceEntryRow, type InvoiceFeatures } from "@/components/admin/finance/meta";
import type { FinanceKind, FinanceMethod } from "@/db/schema";
import {
  INVOICE_ACCEPT,
  INVOICE_MAX_BYTES,
  amountToCents,
  cleanAfm,
  fromNet,
  fromTotal,
  solveTotals,
  totalsDiff,
  validAfm,
  type InvoiceReading,
  type ReadingField,
  type TotalsField,
} from "@/lib/invoices";
import { formatEuro } from "@/server/money";
import type { FinanceAttachment } from "@/server/services/finance";
import { saveFinanceEntryAction } from "./actions";

export type SupplierOption = { id: number; name: string; vatNumber: string | null };
export type EntryModal = { kind: FinanceKind; entry?: FinanceEntryRow } | null;

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** POST multipart σε route handler· κάθε αποτυχία (δίκτυο, λήξη σύνδεσης, μη-JSON) γίνεται καθαρό μήνυμα. */
async function postForm<T>(url: string, fd: FormData, what: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: fd });
  } catch {
    return { ok: false, error: `Δεν υπάρχει σύνδεση με τον server (${what}). Έλεγξε το internet και δοκίμασε ξανά.` };
  }
  try {
    const j = (await res.json()) as Partial<ApiResult<T>> & { error?: string };
    if (j && j.ok === true) return j as ApiResult<T>;
    if (res.status === 401) return { ok: false, error: "Η σύνδεσή σου έληξε. Άνοιξε νέα καρτέλα, συνδέσου ξανά και ξαναπάτησε — ό,τι έγραψες μένει εδώ." };
    return { ok: false, error: j?.error || `Κάτι πήγε στραβά (${what}, σφάλμα ${res.status}).` };
  } catch {
    return { ok: false, error: `Ο server δεν απάντησε σωστά (${what}, σφάλμα ${res.status}). Δοκίμασε ξανά.` };
  }
}

/** Μεγάλες φωτογραφίες μικραίνουν ΜΟΝΟ για την ανάγνωση (το πρωτότυπο ανεβαίνει αυτούσιο στο Drive). */
async function shrinkForReading(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 3_500_000) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2576 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const toInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : centsToInput(cents));
/** "" -> null, μη έγκυρο -> undefined. */
const parseAmount = (s: string): number | null | undefined => (s.trim() ? (amountToCents(s) ?? undefined) : null);

const NEW = "new";

export function EntryForm({
  modal,
  onClose,
  suppliers: activeSuppliers,
  defaultDate,
  features,
  runner,
}: {
  modal: EntryModal;
  onClose: () => void;
  suppliers: SupplierOption[];
  defaultDate: string;
  features: InvoiceFeatures;
  runner: ReturnType<typeof useActionRunner>;
}) {
  const e = modal?.entry;
  // Κίνηση με προμηθευτή που έχει απενεργοποιηθεί στο μεταξύ: μένει επιλέξιμος, για να μη χαθεί στην επεξεργασία.
  const suppliers =
    e?.supplierId && e.supplierName && !activeSuppliers.some((s) => s.id === e.supplierId)
      ? [...activeSuppliers, { id: e.supplierId, name: e.supplierName, vatNumber: e.supplierAfm }]
      : activeSuppliers;
  const [kind, setKind] = useState<FinanceKind>(modal?.kind ?? "expense");
  const [date, setDate] = useState(e?.date ?? defaultDate);
  const [docNumber, setDocNumber] = useState(e?.docNumber ?? "");
  const [supplier, setSupplier] = useState<string>(e?.supplierId ? String(e.supplierId) : "");
  const [newName, setNewName] = useState("");
  const [newAfm, setNewAfm] = useState("");
  const [amounts, setAmounts] = useState<Record<TotalsField, string>>({
    net: toInput(e ? (e.netCents ?? (e.vatCents > 0 ? e.amountCents - e.vatCents : null)) : null),
    vat: e && (e.vatCents > 0 || e.netCents !== null) ? toInput(e.vatCents) : "",
    total: toInput(e?.amountCents),
  });
  /** Ποια ποσά έγραψε τελευταία ο χρήστης: τα δύο πιο πρόσφατα υπολογίζουν το τρίτο. */
  const [touched, setTouched] = useState<TotalsField[]>(e ? ["net", "vat", "total"] : []);
  const [paid, setPaid] = useState(e ? e.paid : true);
  const [paidAt, setPaidAt] = useState<string | null>(e?.paidAt ?? null);
  const [hasDue, setHasDue] = useState(Boolean(e?.dueDate));
  const [dueDate, setDueDate] = useState(e?.dueDate ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  /** Αρχείο που ανέβηκε ήδη σε αυτή τη φόρμα (αν αποτύχει η αποθήκευση δεν ξανανεβαίνει). */
  const [uploaded, setUploaded] = useState<{ file: File; attachment: FinanceAttachment } | null>(null);
  const [reading, setReading] = useState<InvoiceReading | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [check, setCheck] = useState<ReadingField[]>([]);
  const [busy, setBusy] = useState<null | "upload" | "save">(null);
  const [formError, setFormError] = useState<{ text: string; canSkipFile: boolean } | null>(null);
  const skipFile = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const expense = kind === "expense";
  const cats = expense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const existing = e?.attachmentUrl && !removeExisting ? { url: e.attachmentUrl, name: e.attachmentName ?? "Συνημμένο" } : null;
  const canAttach = features.drive || features.ai;
  const reviewed = (f: ReadingField) => setCheck((c) => (c.includes(f) ? c.filter((x) => x !== f) : c));
  const flag = (f: ReadingField) => check.includes(f);
  // Το «!» χρειάζεται επειδή η κλάση .input (globals.css) ορίζει ήδη χρώμα περιγράμματος εκτός layer.
  const ring = (f: ReadingField) => (flag(f) ? " border-warn! ring-2 ring-warn-soft" : "");

  const cents: Record<TotalsField, number | null | undefined> = { net: parseAmount(amounts.net), vat: parseAmount(amounts.vat), total: parseAmount(amounts.total) };
  const diff = cents.net !== undefined && cents.vat !== undefined && cents.total !== undefined ? totalsDiff({ net: cents.net, vat: cents.vat, total: cents.total }) : null;

  function setAmount(field: TotalsField, value: string) {
    const order = [...touched.filter((f) => f !== field), field];
    const next = { ...amounts, [field]: value };
    if (expense && order.length >= 2) {
      const keep = order.slice(-2) as [TotalsField, TotalsField];
      const a = parseAmount(next[keep[0]]);
      const b = parseAmount(next[keep[1]]);
      if (typeof a === "number" && typeof b === "number") {
        const solved = solveTotals({ net: null, vat: null, total: null, [keep[0]]: a, [keep[1]]: b }, keep);
        if (solved.computed && solved[solved.computed]! >= 0) next[solved.computed] = centsToInput(solved[solved.computed]!);
      }
    }
    setTouched(order);
    setAmounts(next);
    reviewed(field);
  }

  /** Κουμπιά 24% / 13% / 6%: από το καθαρό αν αυτό γράφτηκε τελευταίο, αλλιώς από το σύνολο. */
  function applyRate(rate: number) {
    const lastNet = touched.lastIndexOf("net");
    const lastTotal = touched.lastIndexOf("total");
    const useNet = typeof cents.net === "number" && (lastNet > lastTotal || typeof cents.total !== "number");
    const base = useNet ? cents.net : cents.total;
    if (typeof base !== "number") {
      setFormError({ text: "Γράψε πρώτα το καθαρό ποσό ή το σύνολο και μετά διάλεξε συντελεστή ΦΠΑ.", canSkipFile: false });
      return;
    }
    const r = useNet ? fromNet(base, rate) : fromTotal(base, rate);
    setAmounts({ net: centsToInput(r.net), vat: centsToInput(r.vat), total: centsToInput(r.total) });
    setTouched(useNet ? ["total", "vat", "net"] : ["net", "vat", "total"]);
    setFormError(null);
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    setFileError(null);
    setReadError(null);
    if (f.size > INVOICE_MAX_BYTES) return setFileError(`Το αρχείο είναι ${fileSize(f.size)} — το όριο είναι 10 MB.`);
    if (f.type && !/^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/i.test(f.type) && !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name)) {
      return setFileError("Επιτρέπονται μόνο PDF και φωτογραφίες JPG, PNG, WEBP ή HEIC.");
    }
    setFile(f);
    setUploaded(null);
    setReading(null);
  }

  /** Προσυμπλήρωση από την ανάγνωση. Δεν αποθηκεύει τίποτα: ο χρήστης ελέγχει και πατά Αποθήκευση. */
  function applyReading(r: InvoiceReading) {
    setReading(r);
    setCheck(r.check);
    if (r.docNumber) setDocNumber(r.docNumber);
    if (r.date) setDate(r.date);
    if (r.supplierName || r.afm) {
      const byAfm = r.afm ? suppliers.find((s) => cleanAfm(s.vatNumber) === r.afm) : undefined;
      const low = (s: string) => s.trim().toLocaleLowerCase("el-GR");
      const match = byAfm ?? (r.supplierName ? suppliers.find((s) => low(s.name) === low(r.supplierName!)) : undefined);
      if (match) setSupplier(String(match.id));
      else {
        setSupplier(NEW);
        setNewName(r.supplierName ?? "");
        setNewAfm(r.afm ?? "");
      }
    }
    const got = (["net", "vat", "total"] as const).filter((f) => r[`${f}Cents`] !== null);
    if (got.length) {
      setAmounts((a) => ({ net: r.netCents !== null ? centsToInput(r.netCents) : a.net, vat: r.vatCents !== null ? centsToInput(r.vatCents) : a.vat, total: r.totalCents !== null ? centsToInput(r.totalCents) : a.total }));
      setTouched(got);
    }
  }

  async function readInvoice() {
    if (!file || readBusy) return;
    setReadBusy(true);
    setReadError(null);
    const fd = new FormData();
    fd.append("file", await shrinkForReading(file), file.name);
    const r = await postForm<InvoiceReading>("/api/invoices/read", fd, "ανάγνωση τιμολογίου");
    setReadBusy(false);
    if (r.ok) applyReading(r.data);
    else setReadError(r.error);
  }

  async function submit(fd: FormData) {
    const withoutFile = skipFile.current;
    skipFile.current = false;
    if (busy) return;
    const v = formValues(fd);
    const stop = (text: string, canSkipFile = false) => setFormError({ text, canSkipFile });
    if (cents.net === undefined || cents.vat === undefined || cents.total === undefined) return stop("Κάποιο ποσό δεν είναι έγκυρο. Γράψε π.χ. 124,00");
    const amountCents = cents.total ?? 0;
    if (amountCents <= 0) return stop(expense ? "Συμπλήρωσε το σύνολο του παραστατικού." : "Συμπλήρωσε το ποσό.");
    const vatCents = cents.vat ?? (expense && cents.net !== null ? amountCents - cents.net : 0);
    const netCents = expense ? (cents.net ?? (cents.vat !== null ? amountCents - cents.vat : null)) : null;
    const creating = expense && supplier === NEW;
    if (creating && !newName.trim()) return stop("Γράψε την επωνυμία του νέου προμηθευτή ή διάλεξε έναν από τη λίστα.");
    if (creating && newAfm.trim() && !validAfm(cleanAfm(newAfm))) return stop("Το ΑΦΜ του προμηθευτή δεν είναι έγκυρο (9 ψηφία). Διόρθωσέ το ή άφησέ το κενό.");
    const supplierLabel = creating ? newName.trim() : (suppliers.find((s) => String(s.id) === supplier)?.name ?? "");
    setFormError(null);

    let attachment: FinanceAttachment | null | undefined;
    if (expense && file && features.drive && !withoutFile) {
      if (uploaded?.file === file) attachment = uploaded.attachment;
      else {
        setBusy("upload");
        const up = new FormData();
        up.append("file", file, file.name);
        up.append("date", date);
        up.append("supplier", supplierLabel);
        up.append("docNumber", docNumber);
        const r = await postForm<FinanceAttachment>("/api/invoices/upload", up, "ανέβασμα στο Drive");
        if (!r.ok) {
          setBusy(null);
          return stop(`Το αρχείο δεν ανέβηκε στο Google Drive: ${r.error}`, true);
        }
        attachment = r.data;
        setUploaded({ file, attachment: r.data });
      }
    } else if (e?.attachmentUrl && (removeExisting || !expense)) attachment = null;

    setBusy("save");
    const res = await saveFinanceEntryAction({
      id: e?.id,
      kind,
      date,
      category: v.str("category"),
      description: v.str("description"),
      amountCents,
      vatCents,
      netCents,
      method: v.str("method") as FinanceMethod,
      supplierId: expense && supplier && supplier !== NEW ? Number(supplier) : null,
      newSupplier: creating ? { name: newName.trim(), vatNumber: cleanAfm(newAfm) || null } : null,
      docNumber: docNumber.trim() || null,
      paid: expense ? paid : true,
      dueDate: expense && !paid && hasDue && dueDate ? dueDate : null,
      paidAt: expense && paid ? (paidAt ?? date) : null,
      attachment,
    }).catch(() => ({ ok: false as const, error: "Δεν υπάρχει σύνδεση με τον server. Ό,τι έγραψες μένει στη φόρμα — δοκίμασε ξανά." }));
    setBusy(null);
    if (!res.ok) return stop(res.error);
    runner.toast(e ? "Η κίνηση ενημερώθηκε" : expense ? (attachment ? "Το τιμολόγιο καταχωρήθηκε και το αρχείο ανέβηκε στο Drive" : "Το έξοδο καταχωρήθηκε") : "Το έσοδο καταχωρήθηκε");
    onClose();
  }

  const title = e ? (expense ? "Επεξεργασία τιμολογίου / εξόδου" : "Επεξεργασία εσόδου") : expense ? "Νέο τιμολόγιο / έξοδο" : "Νέο έσοδο";
  const afmDigits = cleanAfm(newAfm);
  const afmHint = !newAfm.trim() ? "Προαιρετικό" : validAfm(afmDigits) ? "✓ Έγκυρο ΑΦΜ" : afmDigits.length === 9 ? "Το ΑΦΜ δεν περνά τον έλεγχο — ξανακοίταξέ το" : "Το ΑΦΜ έχει 9 ψηφία";

  return (
    <FormModal open={modal !== null} onClose={onClose} title={title} onSubmit={submit} pending={busy !== null} wide={expense}>
      <div className="grid grid-cols-2 gap-2">
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${kind === k ? (k === "income" ? "bg-ok-soft border-ok text-ok" : "bg-danger-soft border-danger text-danger") : "border-line text-ink-2"}`}
          >
            {k === "income" ? "Έσοδο" : "Τιμολόγιο / έξοδο"}
          </button>
        ))}
      </div>

      {expense && (
        <div className="rounded-xl border border-dashed border-line bg-white/40 p-3 space-y-2" data-testid="attach-box">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink-2">Επισύναψη παραστατικού</span>
            {canAttach && (
              <span className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => cameraInput.current?.click()} disabled={busy !== null}>
                  📷 Φωτογραφία
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
                  📎 Αρχείο
                </button>
              </span>
            )}
          </div>
          {canAttach && (
            <>
              <input ref={fileInput} type="file" className="hidden" accept={INVOICE_ACCEPT} data-testid="invoice-file" onChange={(ev) => (pickFile(ev.target.files?.[0]), (ev.target.value = ""))} />
              {/* Στο κινητό το capture ανοίγει κατευθείαν την πίσω κάμερα. */}
              <input ref={cameraInput} type="file" className="hidden" accept="image/*" capture="environment" data-testid="invoice-camera" onChange={(ev) => (pickFile(ev.target.files?.[0]), (ev.target.value = ""))} />
            </>
          )}
          {file ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 break-all">
                📄 {file.name} <span className="text-ink-3 num">· {fileSize(file.size)}</span>
              </span>
              <button type="button" className="text-xs text-rose-600 underline-offset-2 hover:underline" onClick={() => (setFile(null), setUploaded(null), setReading(null), setReadError(null))}>
                Αφαίρεση
              </button>
              {features.ai && !isHeic(file) && (
                <button type="button" className="btn-primary btn-sm ml-auto" onClick={readInvoice} disabled={readBusy || busy !== null}>
                  {readBusy ? "Διαβάζω το τιμολόγιο…" : "✨ Ανάγνωση τιμολογίου"}
                </button>
              )}
            </div>
          ) : existing ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a href={existing.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all underline underline-offset-2">
                📎 {existing.name}
              </a>
              <button type="button" className="text-xs text-rose-600 underline-offset-2 hover:underline" onClick={() => setRemoveExisting(true)}>
                Αφαίρεση από την κίνηση
              </button>
            </div>
          ) : (
            canAttach && <div className="text-xs text-ink-3">PDF ή φωτογραφία (JPG, PNG, WEBP, HEIC) έως 10 MB.</div>
          )}
          {removeExisting && !file && <div className="text-xs text-ink-3">Το συνημμένο θα αφαιρεθεί από την κίνηση· το αρχείο μένει στο Google Drive.</div>}
          {file && e?.attachmentUrl && features.drive && <div className="text-xs text-ink-3">Το νέο αρχείο θα αντικαταστήσει το συνημμένο· το παλιό μένει στο Google Drive.</div>}
          {file && features.ai && isHeic(file) && <div className="text-xs text-ink-3">Οι φωτογραφίες HEIC δεν διαβάζονται αυτόματα· το αρχείο αποθηκεύεται κανονικά.</div>}
          {fileError && <div className="text-sm text-danger">{fileError}</div>}
          {!features.drive && (
            <div className="text-xs text-ink-2" data-testid="drive-hint">
              {features.ai ? "Το Google Drive δεν είναι συνδεδεμένο: το αρχείο μπορεί να διαβαστεί, αλλά δεν θα αποθηκευτεί. " : "Για να κρατάς το αρχείο του παραστατικού, σύνδεσε το Google Drive. "}
              <Link href="/admin/settings#google-drive" className="underline underline-offset-2 font-medium">
                Ρυθμίσεις → Google Drive
              </Link>
            </div>
          )}
          {features.drive && features.driveNeedsReconnect && (
            <div className="text-xs text-warn">
              Το Google Drive χρειάζεται επανασύνδεση — το ανέβασμα μπορεί να αποτύχει.{" "}
              <Link href="/admin/settings#google-drive" className="underline underline-offset-2 font-medium">
                Ρυθμίσεις → Google Drive
              </Link>
            </div>
          )}
          {readError && (
            <InfoBox tone="warn">
              <span data-testid="read-error">{readError}</span>
            </InfoBox>
          )}
          {reading && (
            <InfoBox tone={reading.warnings.length ? "warn" : "ok"}>
              <div data-testid="read-result">
                Τα στοιχεία προσυμπληρώθηκαν από την ανάγνωση. <strong>Τίποτα δεν έχει αποθηκευτεί</strong> — έλεγξε όσα πεδία γράφουν «έλεγξε» και πάτησε Αποθήκευση.
                {reading.warnings.length > 0 && (
                  <ul className="list-disc pl-5 mt-1">
                    {reading.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </InfoBox>
          )}
        </div>
      )}

      {expense && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Labeled label="Προμηθευτής" check={flag("supplierName") && supplier !== NEW}>
            <select
              className={`input${supplier !== NEW ? ring("supplierName") : ""}`}
              value={supplier}
              aria-label="Προμηθευτής"
              onChange={(ev) => {
                setSupplier(ev.target.value);
                reviewed("supplierName");
                reviewed("afm");
              }}
            >
              <option value="">— χωρίς προμηθευτή —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.vatNumber ? ` · ${s.vatNumber}` : ""}
                </option>
              ))}
              <option value={NEW}>➕ Νέος προμηθευτής…</option>
            </select>
          </Labeled>
          <Labeled label="Αρ. παραστατικού" check={flag("docNumber")}>
            <input className={`input num${ring("docNumber")}`} value={docNumber} onChange={(ev) => (setDocNumber(ev.target.value), reviewed("docNumber"))} placeholder="π.χ. ΤΔΑ 1532" maxLength={60} />
          </Labeled>
          {supplier === NEW && (
            <>
              <Labeled label="Επωνυμία νέου προμηθευτή" check={flag("supplierName")}>
                <input className={`input${ring("supplierName")}`} value={newName} onChange={(ev) => (setNewName(ev.target.value), reviewed("supplierName"))} placeholder="π.χ. ΚΑΒΑ ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΕ" maxLength={120} />
              </Labeled>
              <Labeled label="ΑΦΜ προμηθευτή" check={flag("afm")} hint={afmHint}>
                <input className={`input num${ring("afm")}`} inputMode="numeric" value={newAfm} onChange={(ev) => (setNewAfm(ev.target.value), reviewed("afm"))} placeholder="9 ψηφία" maxLength={14} />
              </Labeled>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Labeled label={expense ? "Ημ/νία παραστατικού" : "Ημερομηνία"} check={expense && flag("date")}>
          <DateGR value={date} onChange={(iso) => (setDate(iso), reviewed("date"))} />
        </Labeled>
        <Field label="Κατηγορία">
          <select name="category" className="input" defaultValue={e && (cats as readonly string[]).includes(e.category) ? e.category : cats[0]} key={kind}>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      {expense ? (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Labeled label="Καθαρή αξία (€)" check={flag("net")}>
              <input inputMode="decimal" className={`input num${ring("net")}`} value={amounts.net} onChange={(ev) => setAmount("net", ev.target.value)} placeholder="0,00" aria-label="Καθαρή αξία" />
            </Labeled>
            <Labeled label="ΦΠΑ (€)" check={flag("vat")}>
              <input inputMode="decimal" className={`input num${ring("vat")}`} value={amounts.vat} onChange={(ev) => setAmount("vat", ev.target.value)} placeholder="0,00" aria-label="ΦΠΑ" />
            </Labeled>
            <Labeled label="Σύνολο με ΦΠΑ (€)" check={flag("total")}>
              <input inputMode="decimal" className={`input num font-semibold${ring("total")}`} value={amounts.total} onChange={(ev) => setAmount("total", ev.target.value)} placeholder="0,00" aria-label="Σύνολο με ΦΠΑ" />
            </Labeled>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <span>Γράψε δύο ποσά και το τρίτο υπολογίζεται. Ή διάλεξε ΦΠΑ:</span>
            {[24, 13, 6].map((r) => (
              <button key={r} type="button" className="btn-secondary btn-sm" onClick={() => applyRate(r)}>
                {r}%
              </button>
            ))}
          </div>
          {diff !== null && diff !== 0 && (
            <div className="mt-2" data-testid="totals-warning">
              <InfoBox tone="warn">
                Καθαρό + ΦΠΑ = {formatEuro((cents.net ?? 0) + (cents.vat ?? 0))}, αλλά το σύνολο γράφει {formatEuro(cents.total ?? 0)} (διαφορά {formatEuro(Math.abs(diff))}). Έλεγξε τα ποσά στο παραστατικό.
              </InfoBox>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Ποσό με ΦΠΑ (€)">
            <input inputMode="decimal" className="input num" required value={amounts.total} onChange={(ev) => setAmount("total", ev.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Από αυτά ΦΠΑ (€)" hint="Προαιρετικό, για τον λογιστή">
            <div className="flex gap-1.5">
              <input inputMode="decimal" className="input num" value={amounts.vat} onChange={(ev) => setAmount("vat", ev.target.value)} placeholder="0,00" />
              {[24, 13].map((r) => (
                <button
                  key={r}
                  type="button"
                  className="btn-secondary btn-sm shrink-0"
                  onClick={() => typeof cents.total === "number" && setAmounts((a) => ({ ...a, vat: centsToInput(fromTotal(cents.total as number, r).vat) }))}
                >
                  {r}%
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      {expense && (
        <div className="rounded-xl border border-line bg-white/40 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Κατάσταση πληρωμής">
            <button type="button" onClick={() => setPaid(true)} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${paid ? "bg-ok-soft border-ok text-ok" : "border-line text-ink-2"}`}>
              ✓ Πληρωμένο
            </button>
            <button type="button" onClick={() => setPaid(false)} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${!paid ? "bg-warn-soft border-warn text-warn" : "border-line text-ink-2"}`}>
              ⏳ Οφείλεται
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={paid ? "Τρόπος πληρωμής" : "Τρόπος πληρωμής (προβλεπόμενος)"}>
              <MethodSelect defaultValue={e?.method ?? "bank"} />
            </Field>
            {paid ? (
              <Field label="Ημ/νία πληρωμής" hint={paidAt && paidAt !== date ? undefined : "Ίδια με το παραστατικό, εκτός αν την αλλάξεις."}>
                <DateGR value={paidAt ?? date} onChange={setPaidAt} />
              </Field>
            ) : (
              <div>
                <span className="label">Λήξη πληρωμής</span>
                <div className="space-y-2">
                  <Toggle label="Έχει προθεσμία" checked={hasDue} onChange={(on) => (setHasDue(on), on && !dueDate && setDueDate(addDaysIso(date, 30)))} />
                  {hasDue && <DateGR value={dueDate || addDaysIso(date, 30)} onChange={setDueDate} />}
                </div>
              </div>
            )}
          </div>
          {!paid && <div className="text-xs text-ink-3">Μετράει κανονικά στα έξοδα του μήνα {fmtIsoDate(date).slice(3)} (ημερομηνία παραστατικού) και εμφανίζεται στις οφειλές μέχρι να το σημάνεις ως πληρωμένο.</div>}
        </div>
      )}

      {!expense && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Τρόπος πληρωμής">
            <MethodSelect defaultValue={e?.method ?? "bank"} />
          </Field>
          <Field label="Αρ. παραστατικού">
            <input className="input num" value={docNumber} onChange={(ev) => setDocNumber(ev.target.value)} placeholder="π.χ. ΑΠΥ 214" maxLength={60} />
          </Field>
        </div>
      )}

      <Field label="Περιγραφή">
        <input name="description" className="input" defaultValue={e?.description ?? ""} placeholder={expense ? "π.χ. Ενοίκιο Νοεμβρίου" : "π.χ. Προκαταβολή γάμου Παπαδόπουλου"} maxLength={300} />
      </Field>

      {busy === "upload" && <div className="text-sm text-ink-2">⏫ Ανεβαίνει το αρχείο στο Google Drive…</div>}
      {formError && (
        <div data-testid="form-error">
          <InfoBox tone="danger">
            <div>{formError.text}</div>
            {formError.canSkipFile && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-ink-2">Ό,τι έγραψες μένει στη φόρμα. Δοκίμασε ξανά με «Αποθήκευση» ή:</span>
                <button type="submit" className="btn-secondary btn-sm" onClick={() => (skipFile.current = true)} disabled={busy !== null}>
                  Αποθήκευση χωρίς το αρχείο
                </button>
              </div>
            )}
          </InfoBox>
        </div>
      )}
    </FormModal>
  );
}

function MethodSelect({ defaultValue }: { defaultValue: FinanceMethod }) {
  return (
    <select name="method" className="input" defaultValue={defaultValue}>
      {(Object.keys(FINANCE_METHOD_LABEL) as FinanceMethod[]).map((m) => (
        <option key={m} value={m}>
          {FINANCE_METHOD_LABEL[m]}
        </option>
      ))}
    </select>
  );
}

/** Πεδίο με ετικέτα και σήμανση «έλεγξε» για ό,τι προσυμπληρώθηκε με αβεβαιότητα. */
function Labeled({ label, check, hint, children }: { label: string; check?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {check && (
          <span className="chip bg-warn-soft text-warn ml-2" data-testid="check-chip">
            έλεγξε
          </span>
        )}
      </span>
      {children}
      {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}
