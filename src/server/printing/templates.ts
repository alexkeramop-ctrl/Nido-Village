/**
 * Πρότυπα εισιτηρίων: κουζίνα, ακύρωση, λογαριασμός, απόδειξη (για όταν συνδεθεί πάροχος), δοκιμή.
 */
import { Ticket, type TicketDoc } from "./ticket";
import { formatEuro } from "@/server/money";

const ATHENS = "Europe/Athens";

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ATHENS });
}
export function fmtDateTime(d: Date): string {
  return d.toLocaleString("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ATHENS,
  });
}

export type KitchenItem = {
  qty: number;
  name: string;
  modifiers: string[];
  notes?: string | null;
  course: number;
};

export type KitchenTicketInput = {
  stationName: string;
  tableName: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  label?: string | null;
  waiter: string;
  roundNo: number;
  time: Date;
  items: KitchenItem[];
  notes?: string | null;
};

const ORDER_TYPE_LABEL = { dine_in: "ΤΡΑΠΕΖΙ", takeaway: "ΠΑΚΕΤΟ", delivery: "DELIVERY" } as const;
const COURSE_LABEL: Record<number, string> = { 1: "1ο ΠΙΑΤΟ", 2: "2ο ΠΙΑΤΟ", 3: "3ο ΠΙΑΤΟ", 4: "ΕΠΙΔΟΡΠΙΟ" };

export function kitchenTicket(i: KitchenTicketInput): TicketDoc {
  const t = new Ticket();
  t.beep();
  t.text(i.stationName, { align: "center", bold: true });
  t.title(`${ORDER_TYPE_LABEL[i.orderType]} ${i.tableName}`);
  if (i.label && i.label !== i.tableName) t.center(i.label, true);
  t.row(`Γύρος ${i.roundNo}`, fmtTime(i.time));
  t.row(`Σερβ.: ${i.waiter}`, fmtDateTime(i.time).slice(0, 10));
  t.hr("=");
  const byCourse = new Map<number, KitchenItem[]>();
  for (const it of i.items) byCourse.set(it.course, [...(byCourse.get(it.course) ?? []), it]);
  const courses = [...byCourse.keys()].sort((a, b) => a - b);
  for (const c of courses) {
    if (courses.length > 1 || c !== 1) t.text(COURSE_LABEL[c] ?? `ΠΙΑΤΟ ${c}`, { bold: true, underline: true });
    for (const it of byCourse.get(c)!) {
      t.text(`${it.qty} x ${it.name}`, { bold: true, size: 2 });
      for (const m of it.modifiers) t.text(`   + ${m}`);
      if (it.notes) t.text(`   ** ${it.notes}`, { bold: true });
    }
    t.feed(1);
  }
  if (i.notes) {
    t.hr();
    t.text(`ΣΗΜ.: ${i.notes}`, { bold: true });
  }
  t.hr("=");
  t.cut();
  return t.doc();
}

export function voidTicket(i: {
  stationName: string;
  tableName: string;
  waiter: string;
  time: Date;
  item: KitchenItem;
  reason: string;
}): TicketDoc {
  const t = new Ticket();
  t.beep().beep();
  t.text(i.stationName, { align: "center", bold: true });
  t.title("*** ΑΚΥΡΩΣΗ ***");
  t.title(i.tableName);
  t.row(`Σερβ.: ${i.waiter}`, fmtTime(i.time));
  t.hr("=");
  t.text(`${i.item.qty} x ${i.item.name}`, { bold: true, size: 2 });
  for (const m of i.item.modifiers) t.text(`   + ${m}`);
  t.text(`Αιτία: ${i.reason}`, { bold: true });
  t.hr("=");
  t.cut();
  return t.doc();
}

export type BillLine = { qty: number; name: string; modifiers: string[]; lineTotalCents: number };
export type VatBreakdown = { ratePct: number; netCents: number; vatCents: number; grossCents: number }[];

export type BillInput = {
  venueName: string;
  tableName: string;
  waiter: string;
  time: Date;
  covers: number;
  lines: BillLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  vat: VatBreakdown;
  sessionId: number;
};

export function billTicket(i: BillInput): TicketDoc {
  const t = new Ticket();
  t.title(i.venueName);
  t.center("ΛΟΓΑΡΙΑΣΜΟΣ ΤΡΑΠΕΖΙΟΥ", true);
  t.row(`Τραπέζι: ${i.tableName}`, fmtDateTime(i.time));
  t.row(`Σερβ.: ${i.waiter}`, i.covers ? `Άτομα: ${i.covers}` : "");
  t.hr("=");
  for (const l of i.lines) {
    t.row(`${l.qty} x ${l.name}`, formatEuro(l.lineTotalCents));
    for (const m of l.modifiers) t.text(`     + ${m}`);
  }
  t.hr();
  if (i.discountCents > 0) {
    t.row("Υποσύνολο", formatEuro(i.subtotalCents));
    t.row("Έκπτωση", `-${formatEuro(i.discountCents)}`);
  }
  t.row("ΣΥΝΟΛΟ", formatEuro(i.totalCents), { bold: true, size: 2 });
  t.hr();
  for (const v of i.vat) t.row(`ΦΠΑ ${v.ratePct}% (καθ. ${formatEuro(v.netCents)})`, formatEuro(v.vatCents));
  t.hr("=");
  t.center("ΔΕΝ ΑΠΟΤΕΛΕΙ ΦΟΡΟΛΟΓΙΚΟ ΣΤΟΙΧΕΙΟ", true);
  t.center("Η απόδειξη εκδίδεται από την ταμειακή.");
  t.center(`#${i.sessionId}`);
  t.cut();
  return t.doc();
}

export type ReceiptInput = BillInput & {
  venue: { vatNumber: string; address: string; phone: string; taxOffice: string };
  fiscal: { series?: string; number?: string; mark?: string; uid?: string; qrUrl?: string; providerName: string };
  payments: { method: "cash" | "card" | "other"; amountCents: number; posTransactionId?: string | null }[];
};

/** Απόδειξη λιανικής (11.1) – χρησιμοποιείται ΜΟΝΟ όταν ο πάροχος έχει επιστρέψει ΜΑΡΚ/UID. */
export function receiptTicket(i: ReceiptInput): TicketDoc {
  const t = new Ticket();
  t.title(i.venueName);
  t.center(i.venue.address);
  t.center(`ΑΦΜ ${i.venue.vatNumber} · ΔΟΥ ${i.venue.taxOffice}`);
  t.center(`Τηλ. ${i.venue.phone}`);
  t.hr("=");
  t.center("ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ", true);
  t.row(`${i.fiscal.series ?? ""} ${i.fiscal.number ?? ""}`.trim(), fmtDateTime(i.time));
  t.row(`Τραπέζι: ${i.tableName}`, `Σερβ.: ${i.waiter}`);
  t.hr();
  for (const l of i.lines) {
    t.row(`${l.qty} x ${l.name}`, formatEuro(l.lineTotalCents));
    for (const m of l.modifiers) t.text(`     + ${m}`);
  }
  t.hr();
  if (i.discountCents > 0) {
    t.row("Υποσύνολο", formatEuro(i.subtotalCents));
    t.row("Έκπτωση", `-${formatEuro(i.discountCents)}`);
  }
  t.row("ΣΥΝΟΛΟ", formatEuro(i.totalCents), { bold: true, size: 2 });
  for (const v of i.vat) t.row(`ΦΠΑ ${v.ratePct}% καθ. ${formatEuro(v.netCents)}`, formatEuro(v.vatCents));
  t.hr();
  const METHOD = { cash: "ΜΕΤΡΗΤΑ", card: "ΚΑΡΤΑ", other: "ΑΛΛΟ" } as const;
  for (const p of i.payments) {
    t.row(METHOD[p.method], formatEuro(p.amountCents));
    if (p.posTransactionId) t.text(`  POS: ${p.posTransactionId}`);
  }
  t.hr("=");
  if (i.fiscal.mark) t.text(`ΜΑΡΚ: ${i.fiscal.mark}`);
  if (i.fiscal.uid) t.text(`UID: ${i.fiscal.uid}`);
  t.center(`Πάροχος: ${i.fiscal.providerName}`);
  if (i.fiscal.qrUrl) t.qr(i.fiscal.qrUrl, 5);
  t.center("Ευχαριστούμε!");
  t.cut();
  t.drawer();
  return t.doc();
}

export function testTicket(stationName: string, columns: number): TicketDoc {
  const t = new Ticket();
  t.title("NIDO VILLAGE");
  t.center(`Δοκιμή εκτυπωτή: ${stationName}`, true);
  t.row("Ώρα", fmtDateTime(new Date()));
  t.hr("=");
  t.text("Ελληνικά πεζά: αβγδεζηθικλμνξοπρστυφχψω");
  t.text("ΕΛΛΗΝΙΚΑ ΚΕΦΑΛΑΙΑ: ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ");
  t.text("Τόνοι: άέήίόύώ ΆΈΉΊΌΎΏ ϊϋΐΰ");
  t.text("Έντονα", { bold: true });
  t.text("Διπλό μέγεθος", { size: 2 });
  t.text(`Στήλες: ${columns}`);
  t.text("0123456789".repeat(6).slice(0, columns));
  t.row("Σύνολο", formatEuro(1234567));
  t.qr("https://nido.village/test", 5);
  t.hr("=");
  t.cut();
  return t.doc();
}
