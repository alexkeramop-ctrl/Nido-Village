import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { seeded, employeeByName } from "./helpers";
import { formatPhone, isValidPhone, normalizePhone, telHref, whatsappHref } from "@/lib/phone";
import { birthdayText, dueReminderText, nextAnniversary, payBadge, paymentDescription, paymentNote, summarizePayments } from "@/components/admin/bookings/meta";
import { bookingsDueSummary, deleteEventPayment, eventPayments, listBookingsDue, paymentTotalsByEvent, recordEventPayment } from "@/server/services/booking-payments";
import { customersCsv, deleteCustomer, findCustomerByPhone, linkUnlinkedEvents, listCustomers, saveCustomer, setCustomerConsent } from "@/server/services/customers";
import { upcomingBirthdays } from "@/server/services/birthdays";
import { pendingWebsiteRequests, setEventStatus, upsertEvent } from "@/server/services/events";
import { financeMonth } from "@/server/services/finance";
import { addDays, todayAthens } from "@/server/services/reports";

let admin: { id: number };
const today = todayAthens();

beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});

describe("τηλέφωνα", () => {
  it("κανονικοποιεί ελληνικά κινητά (κενά, παύλες, +30, 0030)", () => {
    expect(normalizePhone("+30 691 234 5678")).toBe("6912345678");
    expect(normalizePhone("0030-691-234-5678")).toBe("6912345678");
    expect(normalizePhone("691 234-5678")).toBe("6912345678");
    expect(normalizePhone("306912345678")).toBe("6912345678");
    expect(normalizePhone("(2310) 123.456")).toBe("2310123456");
    expect(normalizePhone("+49 151 1234 5678")).toBe("004915112345678");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });

  it("αναγνωρίζει έγκυρα τηλέφωνα και φτιάχνει συνδέσμους", () => {
    expect(isValidPhone("6912345678")).toBe(true);
    expect(isValidPhone("2310123456")).toBe(true);
    expect(isValidPhone("004915112345678")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("691234567")).toBe(false);
    expect(isValidPhone("7912345678")).toBe(false);
    expect(telHref("691 234 5678")).toBe("tel:+306912345678");
    expect(whatsappHref("+30 691 234 5678")).toBe("https://wa.me/306912345678");
    expect(whatsappHref("6912345678", "Γεια σας & καλή μέρα")).toBe(`https://wa.me/306912345678?text=${encodeURIComponent("Γεια σας & καλή μέρα")}`);
    expect(whatsappHref("+49 151 1234 5678")).toBe("https://wa.me/4915112345678");
    // Τα σταθερά δεν έχουν WhatsApp, τα άκυρα δεν δίνουν σύνδεσμο.
    expect(whatsappHref("2310123456")).toBeNull();
    expect(whatsappHref("123")).toBeNull();
    expect(telHref("abc")).toBeNull();
    expect(formatPhone("+306912345678")).toBe("691 234 5678");
  });
});

describe("πληρωμές κρατήσεων", () => {
  it("υπολογίζει εισπράξεις/υπόλοιπο και την ετικέτα (καθαρή συνάρτηση)", () => {
    const ev = { priceCents: 25000, depositCents: 5000, depositPaid: false };
    const none = summarizePayments(ev, undefined);
    expect(none).toMatchObject({ paidCents: 0, balanceCents: 25000, state: "unpaid", legacyDepositCents: 0 });
    expect(payBadge("confirmed", none)?.label).toBe("Χωρίς προκαταβολή");
    expect(payBadge("inquiry", none)).toBeNull();
    const part = summarizePayments(ev, { depositCents: 5000, settlementCents: 0 });
    expect(part).toMatchObject({ paidCents: 5000, balanceCents: 20000, state: "partial" });
    expect(payBadge("confirmed", part)?.label).toBe("Προκαταβολή ✓ · υπόλοιπο 200,00 €");
    const full = summarizePayments(ev, { depositCents: 5000, settlementCents: 20000 });
    expect(full).toMatchObject({ paidCents: 25000, balanceCents: 0, state: "paid" });
    expect(payBadge("done", full)?.label).toBe("Εξοφλημένο");
    // Χωρίς τιμή δεν υπολογίζεται υπόλοιπο.
    expect(summarizePayments({ priceCents: 0, depositCents: 0, depositPaid: false }, { depositCents: 3000, settlementCents: 0 })).toMatchObject({ state: "free", balanceCents: 0, paidCents: 3000 });
    // Παλιά εγγραφή με τσεκαρισμένη προκαταβολή: μετράει μέχρι να καταχωρηθεί πληρωμή προκαταβολής.
    const legacy = { priceCents: 25000, depositCents: 5000, depositPaid: true };
    expect(summarizePayments(legacy, undefined)).toMatchObject({ paidCents: 5000, balanceCents: 20000, legacyDepositCents: 5000, state: "partial" });
    expect(summarizePayments(legacy, { depositCents: 0, settlementCents: 20000 })).toMatchObject({ paidCents: 25000, state: "paid", legacyDepositCents: 5000 });
    expect(summarizePayments(legacy, { depositCents: 6000, settlementCents: 0 })).toMatchObject({ paidCents: 6000, legacyDepositCents: 0 });
  });

  it("η περιγραφή της κίνησης έχει τον τίτλο της κράτησης και η σημείωση διαβάζεται πίσω", () => {
    const d = paymentDescription({ title: "Πάρτι Γιώργου (Frozen)", date: "2026-12-20" }, "  με   έμβασμα ");
    expect(d).toBe("Κράτηση: Πάρτι Γιώργου (Frozen) (20/12/2026) · με έμβασμα");
    expect(paymentNote(d)).toBe("με έμβασμα");
    expect(paymentNote(paymentDescription({ title: "Γάμος", date: "2027-06-05" }))).toBe("");
    expect(paymentNote("ελεύθερο κείμενο")).toBe("ελεύθερο κείμενο");
  });

  it("καταχωρεί προκαταβολή και εξόφληση, αρνείται ποσό πάνω από το υπόλοιπο", async () => {
    const month = today.slice(0, 7);
    const before = await financeMonth(month);
    const ev = await upsertEvent({ title: "Πάρτι Γιώργου", type: "party", status: "confirmed", date: addDays(today, 12), priceCents: 25000, depositCents: 5000 }, admin.id);
    expect((await eventPayments(ev.id)).summary).toMatchObject({ priceCents: 25000, paidCents: 0, balanceCents: 25000, state: "unpaid" });

    const dep = await recordEventPayment({ eventId: ev.id, date: today, amountCents: 5000, method: "cash", type: "deposit", note: "στο ταμείο" }, admin.id);
    expect(dep.warning).toBeNull();
    expect(dep.summary).toMatchObject({ paidCents: 5000, balanceCents: 20000, state: "partial" });

    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 20001, method: "card", type: "settlement" }, admin.id)).rejects.toThrow(/ξεπερνά το υπόλοιπο/);
    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 0, method: "card", type: "settlement" }, admin.id)).rejects.toThrow(/θετικό/);
    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 12.5, method: "card", type: "settlement" }, admin.id)).rejects.toThrow(/θετικό/);
    await expect(recordEventPayment({ eventId: ev.id, date: addDays(today, 1), amountCents: 1000, method: "card", type: "settlement" }, admin.id)).rejects.toThrow(/μελλοντική/);
    await expect(recordEventPayment({ eventId: ev.id, date: "2026-02-30", amountCents: 1000, method: "card", type: "settlement" }, admin.id)).rejects.toThrow(/ημερομηνία/);
    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 1000, method: "other" as never, type: "settlement" }, admin.id)).rejects.toThrow(/τρόπος/);
    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 1000, method: "card", type: "refund" as never }, admin.id)).rejects.toThrow(/τύπος/);
    await expect(recordEventPayment({ eventId: 999999, date: today, amountCents: 1000, method: "card", type: "settlement" }, admin.id)).rejects.toThrow(/δεν βρέθηκε/);
    // Καμία από τις αποτυχημένες προσπάθειες δεν άφησε κίνηση.
    expect((await eventPayments(ev.id)).payments).toHaveLength(1);

    const rest = await recordEventPayment({ eventId: ev.id, date: today, amountCents: 20000, method: "bank", type: "settlement" }, admin.id);
    expect(rest.summary).toMatchObject({ paidCents: 25000, balanceCents: 0, state: "paid" });
    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 100, method: "cash", type: "settlement" }, admin.id)).rejects.toThrow(/ήδη εξοφλημένη/);

    const detail = await eventPayments(ev.id);
    expect(detail.payments.map((p) => [p.type, p.method, p.amountCents, p.note])).toEqual([
      ["deposit", "cash", 5000, "στο ταμείο"],
      ["settlement", "bank", 20000, ""],
    ]);
    expect(await paymentTotalsByEvent([ev.id])).toEqual(new Map([[ev.id, { depositCents: 5000, settlementCents: 20000 }]]));
    expect((await paymentTotalsByEvent([])).size).toBe(0);

    // Οικονομικά μήνα: κάθε πληρωμή μετράει ακριβώς μία φορά, στη σωστή κατηγορία, με τον τίτλο της κράτησης.
    const after = await financeMonth(month);
    expect(after.income.manualTotal - before.income.manualTotal).toBe(25000);
    expect(after.income.total - before.income.total).toBe(25000);
    expect(after.income.posTotal).toBe(before.income.posTotal);
    expect(after.expense.total).toBe(before.expense.total);
    const mine = after.entries.filter((e) => e.eventTitle === "Πάρτι Γιώργου");
    expect(mine.map((e) => [e.kind, e.category, e.amountCents, e.method])).toEqual([
      ["income", "Προκαταβολή εκδήλωσης", 5000, "cash"],
      ["income", "Εξόφληση εκδήλωσης", 20000, "bank"],
    ]);
    expect(mine[0].description).toContain("Πάρτι Γιώργου");
    expect(after.days.find((d) => d.date === today)!.income - before.days.find((d) => d.date === today)!.income).toBe(25000);

    // Διαγραφή πληρωμής: φεύγει από την κράτηση ΚΑΙ από τα οικονομικά.
    await expect(deleteEventPayment(ev.id + 1000, dep.paymentId, admin.id)).rejects.toThrow(/δεν βρέθηκε/);
    const afterDelete = await deleteEventPayment(ev.id, dep.paymentId, admin.id);
    expect(afterDelete).toMatchObject({ paidCents: 20000, balanceCents: 5000, state: "partial" });
    expect((await financeMonth(month)).income.manualTotal - before.income.manualTotal).toBe(20000);
    await expect(deleteEventPayment(ev.id, dep.paymentId, admin.id)).rejects.toThrow(/δεν βρέθηκε/);
  });

  it("δύο ταυτόχρονες πληρωμές δεν αφήνουν ποτέ είσπραξη πάνω από την τιμή", async () => {
    const ev = await upsertEvent({ title: "Γάμος με δύο ταμεία", type: "wedding", status: "confirmed", date: addDays(today, 60), priceCents: 100000 }, admin.id);
    const pay = (amountCents: number) => recordEventPayment({ eventId: ev.id, date: today, amountCents, method: "cash", type: "settlement" }, admin.id);
    const out = await Promise.allSettled([pay(100000), pay(100000), pay(60000)]);
    const detail = await eventPayments(ev.id);
    expect(detail.summary.paidCents).toBeLessThanOrEqual(100000);
    // Όσες απάντησαν «εντάξει» είναι ακριβώς όσες έμειναν γραμμένες (καμία «χαμένη» ή διπλή κίνηση).
    expect(detail.payments).toHaveLength(out.filter((o) => o.status === "fulfilled").length);
    expect(detail.payments.reduce((a, p) => a + p.amountCents, 0)).toBe(detail.summary.paidCents);
  });

  it("χωρίς τιμή επιτρέπει την πληρωμή με προειδοποίηση· σε ακυρωμένη κράτηση την αρνείται", async () => {
    const free = await upsertEvent({ title: "Σχολική εκδρομή", type: "school_trip", status: "confirmed", date: addDays(today, 5), priceCents: 0 }, admin.id);
    const r = await recordEventPayment({ eventId: free.id, date: today, amountCents: 7000, method: "cash", type: "deposit" }, admin.id);
    expect(r.warning).toMatch(/δεν έχει τιμή/);
    expect(r.summary).toMatchObject({ state: "free", paidCents: 7000, balanceCents: 0 });
    // Και δεύτερη πληρωμή περνάει (δεν υπάρχει υπόλοιπο να ξεπεραστεί).
    expect((await recordEventPayment({ eventId: free.id, date: today, amountCents: 99900, method: "card", type: "settlement" }, admin.id)).summary.paidCents).toBe(106900);

    const cancelled = await upsertEvent({ title: "Βάφτιση που ακυρώθηκε", type: "christening", status: "cancelled", date: addDays(today, 8), priceCents: 100000 }, admin.id);
    await expect(recordEventPayment({ eventId: cancelled.id, date: today, amountCents: 1000, method: "cash", type: "deposit" }, admin.id)).rejects.toThrow(/ακυρωμένη/);
  });

  it("η παλιά ένδειξη «πληρώθηκε η προκαταβολή» μένει στις παλιές εγγραφές και δεν αλλάζει από τη φόρμα", async () => {
    const ev = await upsertEvent({ title: "Παλιά βάφτιση", type: "christening", status: "confirmed", date: addDays(today, 20), priceCents: 80000, depositCents: 20000, depositPaid: true }, admin.id);
    // Η φόρμα δεν στέλνει πια depositPaid: η αποθήκευση δεν το μηδενίζει.
    const saved = await upsertEvent({ id: ev.id, title: "Παλιά βάφτιση", type: "christening", status: "confirmed", date: addDays(today, 20), priceCents: 80000, depositCents: 20000 }, admin.id);
    expect(saved.depositPaid).toBe(true);
    expect((await eventPayments(ev.id)).summary).toMatchObject({ paidCents: 20000, balanceCents: 60000, legacyDepositCents: 20000, state: "partial" });
    // Το υπόλοιπο που μπορεί να εισπραχθεί είναι 600 €, όχι 800 €.
    await expect(recordEventPayment({ eventId: ev.id, date: today, amountCents: 60001, method: "bank", type: "settlement" }, admin.id)).rejects.toThrow(/ξεπερνά/);
    const done = await recordEventPayment({ eventId: ev.id, date: today, amountCents: 60000, method: "bank", type: "settlement" }, admin.id);
    expect(done.summary.state).toBe("paid");
    // Νέες κρατήσεις ξεκινούν χωρίς την παλιά ένδειξη.
    const fresh = await upsertEvent({ title: "Νέα κράτηση", type: "wedding", date: addDays(today, 40), priceCents: 500000, depositCents: 100000 }, admin.id);
    expect(fresh.depositPaid).toBe(false);
    expect((await eventPayments(fresh.id)).summary).toMatchObject({ paidCents: 0, state: "unpaid" });
  });

  it("οφειλές: όλες οι μη ακυρωμένες κρατήσεις με υπόλοιπο, κατά ημερομηνία, με σύνολα", async () => {
    const db = await getDb();
    // Καθαρή εικόνα για αυτό το τεστ.
    await db.delete(schema.financeEntries);
    await db.delete(schema.events);
    const past = await upsertEvent({ title: "Πάρτι που έγινε", type: "party", status: "done", date: addDays(today, -10), priceCents: 30000, customerName: "Άννα", customerPhone: "6944444444" }, admin.id);
    const soon = await upsertEvent({ title: "Γάμος", type: "wedding", status: "confirmed", date: addDays(today, 15), priceCents: 900000 }, admin.id);
    const paid = await upsertEvent({ title: "Εξοφλημένο πάρτι", type: "party", status: "confirmed", date: addDays(today, 3), priceCents: 20000 }, admin.id);
    const cancelled = await upsertEvent({ title: "Ακυρωμένο", type: "party", status: "cancelled", date: addDays(today, 4), priceCents: 20000 }, admin.id);
    await upsertEvent({ title: "Ραντεβού χωρίς τιμή", type: "appointment", status: "confirmed", date: addDays(today, 2) }, admin.id);
    await recordEventPayment({ eventId: past.id, date: addDays(today, -10), amountCents: 10000, method: "cash", type: "deposit" }, admin.id);
    await recordEventPayment({ eventId: soon.id, date: today, amountCents: 200000, method: "bank", type: "deposit" }, admin.id);
    await recordEventPayment({ eventId: paid.id, date: today, amountCents: 20000, method: "card", type: "settlement" }, admin.id);

    const due = await listBookingsDue();
    expect(due.rows.map((r) => [r.id, r.pay.balanceCents, r.daysUntil])).toEqual([
      [past.id, 20000, -10],
      [soon.id, 700000, 15],
    ]);
    expect(due.totalCents).toBe(720000);
    expect(due.overdueCents).toBe(20000);
    expect(due.overdueCount).toBe(1);
    expect(due.rows.some((r) => r.id === cancelled.id)).toBe(false);
    expect(await bookingsDueSummary()).toMatchObject({ totalCents: 720000, count: 2 });
    // Μια ακύρωση βγάζει την κράτηση από τις οφειλές.
    await setEventStatus(soon.id, "cancelled", admin.id);
    expect(await bookingsDueSummary()).toMatchObject({ totalCents: 20000, count: 1 });
    expect(dueReminderText({ typeLabel: "Πάρτι", date: past.date, balanceCents: 20000 })).toContain("υπόλοιπο 200,00 €");
  });
});

describe("πελατολόγιο", () => {
  it("η κράτηση με τηλέφωνο δημιουργεί ή βρίσκει τον πελάτη από το κανονικοποιημένο τηλέφωνο", async () => {
    const a = await upsertEvent({ title: "Πάρτι Α", type: "party", status: "confirmed", date: addDays(today, 6), priceCents: 20000, customerName: "Μαρία Παππά", customerPhone: "+30 691 111 2222" }, admin.id);
    expect(a.customerId).toBeTypeOf("number");
    const db = await getDb();
    const c = (await db.query.customers.findFirst({ where: eq(schema.customers.id, a.customerId!) }))!;
    expect(c).toMatchObject({ name: "Μαρία Παππά", phone: "6911112222", email: null, marketingConsent: false });

    // Ίδιο τηλέφωνο γραμμένο αλλιώς: ίδιος πελάτης. Το όνομα δεν αλλάζει, το email που έλειπε συμπληρώνεται.
    const b = await upsertEvent(
      { title: "Πάρτι Β", type: "party", status: "confirmed", date: addDays(today, 30), priceCents: 35000, customerName: "Μαράκι", customerPhone: "0030 691-111-2222", customerEmail: "Maria@Example.com " },
      admin.id,
    );
    expect(b.customerId).toBe(a.customerId);
    const c2 = (await db.query.customers.findFirst({ where: eq(schema.customers.id, a.customerId!) }))!;
    expect(c2).toMatchObject({ name: "Μαρία Παππά", email: "maria@example.com" });

    // Ακυρωμένη κράτηση δεν μετράει στα στατιστικά· χωρίς έγκυρο τηλέφωνο δεν δημιουργείται πελάτης.
    await upsertEvent({ title: "Πάρτι Γ", type: "party", status: "cancelled", date: addDays(today, 50), priceCents: 99900, customerName: "Μαρία", customerPhone: "6911112222" }, admin.id);
    const noPhone = await upsertEvent({ title: "Χωρίς τηλέφωνο", type: "party", date: addDays(today, 7), customerName: "Άγνωστος" }, admin.id);
    expect(noPhone.customerId).toBeNull();
    const junk = await upsertEvent({ title: "Λάθος τηλέφωνο", type: "party", date: addDays(today, 7), customerName: "Κάποιος", customerPhone: "12345" }, admin.id);
    expect(junk.customerId).toBeNull();

    const row = (await listCustomers()).find((x) => x.id === a.customerId)!;
    expect(row).toMatchObject({ bookings: 2, lastBookingDate: addDays(today, 30), totalBookedCents: 55000 });
    expect(await findCustomerByPhone("691 111 2222")).toMatchObject({ id: a.customerId, name: "Μαρία Παππά", bookings: 2, marketingConsent: false });
    expect(await findCustomerByPhone("6999999999")).toBeNull();
    expect(await findCustomerByPhone("abc")).toBeNull();

    // Αλλαγή τηλεφώνου στην κράτηση: συνδέεται με άλλον πελάτη· σβήσιμο τηλεφώνου: αποσυνδέεται.
    const moved = await upsertEvent({ id: b.id, title: "Πάρτι Β", type: "party", status: "confirmed", date: addDays(today, 30), priceCents: 35000, customerName: "Ελένη", customerPhone: "6933334444" }, admin.id);
    expect(moved.customerId).not.toBe(a.customerId);
    const cleared = await upsertEvent({ id: b.id, title: "Πάρτι Β", type: "party", status: "confirmed", date: addDays(today, 30), priceCents: 35000, customerName: "Ελένη", customerPhone: null }, admin.id);
    expect(cleared.customerId).toBeNull();
  });

  it("επεξεργασία, μοναδικό τηλέφωνο, συγκατάθεση και εξαγωγή CSV", async () => {
    const created = await saveCustomer({ name: " Νίκος  Γεωργίου ", phone: "694 555 6666", email: "nikos@example.com", marketingConsent: true }, admin.id);
    expect(created).toMatchObject({ name: "Νίκος Γεωργίου", phone: "6945556666", marketingConsent: true });
    expect(created.consentAt).toBeInstanceOf(Date);
    await expect(saveCustomer({ name: "Άλλος", phone: "+30 694 555 6666" }, admin.id)).rejects.toThrow(/Υπάρχει ήδη πελάτης/);
    await expect(saveCustomer({ name: "", phone: "6945550000" }, admin.id)).rejects.toThrow(/όνομα/);
    await expect(saveCustomer({ name: "Χ", phone: "123" }, admin.id)).rejects.toThrow(/τηλέφωνο/);
    await expect(saveCustomer({ name: "Χ", phone: "6945550000", email: "όχι-email" }, admin.id)).rejects.toThrow(/email/);

    const other = await saveCustomer({ name: "Ρένα", phone: "6970001111" }, admin.id);
    expect(other).toMatchObject({ marketingConsent: false, consentAt: null });
    const on = await setCustomerConsent(other.id, true, admin.id);
    expect(on.marketingConsent).toBe(true);
    expect(on.consentAt).toBeInstanceOf(Date);
    const off = await setCustomerConsent(other.id, false, admin.id);
    expect(off).toMatchObject({ marketingConsent: false, consentAt: null });
    await expect(setCustomerConsent(999999, true, admin.id)).rejects.toThrow(/δεν βρέθηκε/);

    // Επεξεργασία χωρίς αλλαγή συγκατάθεσης κρατά την ημερομηνία της.
    const edited = await saveCustomer({ id: created.id, name: "Νίκος Γεωργίου", phone: "6945556666", notes: "αλλεργία στους ξηρούς καρπούς" }, admin.id);
    expect(edited.consentAt?.getTime()).toBe(created.consentAt?.getTime());
    expect(edited.notes).toBe("αλλεργία στους ξηρούς καρπούς");

    // Νέο τηλέφωνο πελάτη: ακολουθούν και οι κρατήσεις του.
    const ev = await upsertEvent({ title: "Πάρτι Νίκου", type: "party", date: addDays(today, 9), customerName: "Νίκος", customerPhone: "6945556666" }, admin.id);
    expect(ev.customerId).toBe(created.id);
    await saveCustomer({ id: created.id, name: "Νίκος Γεωργίου", phone: "6945557777" }, admin.id);
    const db = await getDb();
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, ev.id) }))!.customerPhone).toBe("6945557777");

    // «Για ενημερώσεις»: μόνο όσοι έχουν συγκατάθεση.
    const marketing = await customersCsv("marketing", admin.id);
    const lines = marketing.csv.replace("﻿", "").split("\r\n");
    expect(lines[0]).toBe('"Όνομα";"Τηλέφωνο";"Email";"Συγκατάθεση από"');
    expect(lines.slice(1).some((l) => l.includes("Νίκος Γεωργίου") && l.includes("6945557777"))).toBe(true);
    expect(marketing.csv).not.toContain("Ρένα");
    const consenting = (await listCustomers()).filter((c) => c.marketingConsent).length;
    expect(marketing.count).toBe(consenting);
    expect(lines).toHaveLength(consenting + 1);
    const all = await customersCsv("all", admin.id);
    expect(all.csv).toContain("Ρένα");
    expect(all.count).toBe((await listCustomers()).length);

    // Όνομα που θα εκτελούνταν ως τύπος στο Excel γράφεται ως κείμενο.
    await saveCustomer({ name: "=HYPERLINK(1)", phone: "6970002222" }, admin.id);
    expect((await customersCsv("all", admin.id)).csv).toContain(`"'=HYPERLINK(1)"`);

    // Διαγραφή: η κράτηση μένει, χωρίς πελάτη και χωρίς τα στοιχεία επικοινωνίας του.
    await deleteCustomer(created.id, admin.id);
    expect(await db.query.events.findFirst({ where: eq(schema.events.id, ev.id) })).toMatchObject({ title: "Πάρτι Νίκου", customerId: null, customerPhone: null, customerEmail: null });
    await expect(deleteCustomer(created.id, admin.id)).rejects.toThrow(/δεν βρέθηκε/);
    // Ο διαγραμμένος πελάτης δεν ξαναδημιουργείται από τις παλιές του κρατήσεις.
    await linkUnlinkedEvents();
    expect(await findCustomerByPhone("6945557777")).toBeNull();
    expect((await listCustomers()).some((c) => c.id === created.id)).toBe(false);
  });

  it("συνδέει με το πελατολόγιο παλιές κρατήσεις που έχουν τηλέφωνο αλλά όχι πελάτη", async () => {
    const db = await getDb();
    const [old] = await db
      .insert(schema.events)
      .values({ title: "Παλιό πάρτι", type: "party", status: "done", date: addDays(today, -200), customerName: "Κατερίνα", customerPhone: "698 000 1111", priceCents: 18000 })
      .returning();
    const [bad] = await db.insert(schema.events).values({ title: "Παλιό χωρίς σωστό τηλέφωνο", type: "party", date: addDays(today, -100), customerPhone: "—" }).returning();
    expect(old.customerId).toBeNull();
    expect(await linkUnlinkedEvents()).toBeGreaterThanOrEqual(1);
    const linked = (await db.query.events.findFirst({ where: eq(schema.events.id, old.id) }))!;
    expect(linked.customerId).toBeTypeOf("number");
    expect((await findCustomerByPhone("6980001111"))?.name).toBe("Κατερίνα");
    expect((await db.query.events.findFirst({ where: eq(schema.events.id, bad.id) }))!.customerId).toBeNull();
    // Δεύτερο πέρασμα: τίποτα νέο.
    expect(await linkUnlinkedEvents()).toBe(0);
  });
});

describe("γενέθλια που πλησιάζουν", () => {
  /** Ημερομηνία πριν από `years` χρόνια της οποίας η επέτειος πέφτει σε `inDays` ημέρες από σήμερα. */
  const partyDateFor = (inDays: number, years = 1) => {
    const target = addDays(today, inDays);
    const md = target.slice(5) === "02-29" ? "02-28" : target.slice(5);
    return `${Number(target.slice(0, 4)) - years}-${md}`;
  };

  it("υπολογίζει την επόμενη επέτειο (και για 29 Φεβρουαρίου)", () => {
    expect(nextAnniversary("2025-12-10", "2026-11-17")).toBe("2026-12-10");
    expect(nextAnniversary("2025-11-10", "2026-11-17")).toBe("2027-11-10");
    expect(nextAnniversary("2025-11-17", "2026-11-17")).toBe("2026-11-17");
    expect(nextAnniversary("2024-02-29", "2026-01-15")).toBe("2026-02-28");
    expect(nextAnniversary("2024-02-29", "2028-01-15")).toBe("2028-02-29");
  });

  it("δείχνει τα παιδιά των οποίων η επέτειος πάρτι πλησιάζει, με κανόνες συγκατάθεσης και νέας κράτησης", async () => {
    const db = await getDb();
    await db.delete(schema.financeEntries);
    await db.delete(schema.events);
    const party = (o: { title: string; date: string; status?: "inquiry" | "confirmed" | "cancelled" | "done"; child?: string; age?: number | null; name: string; phone?: string }) =>
      upsertEvent(
        {
          title: o.title,
          type: "party",
          status: o.status ?? "done",
          date: o.date,
          customerName: o.name,
          customerPhone: o.phone ?? null,
          party: { childName: o.child ?? "", childAge: o.age ?? null, kids: 12, adults: 10 },
        },
        admin.id,
      );

    // 1) Γιώργος: πάρτι πέρσι, επέτειος σε 20 ημέρες, ο γονιός έχει δώσει συγκατάθεση.
    const g = await party({ title: "Πάρτι Γιώργου", date: partyDateFor(20), child: "Γιώργος", age: 5, name: "Μαρία Κ.", phone: "6901010101" });
    await setCustomerConsent(g.customerId!, true, admin.id);
    // 2) Ελένη: επέτειος σε 40 ημέρες, ΧΩΡΙΣ συγκατάθεση.
    await party({ title: "Πάρτι Ελένης", date: partyDateFor(40), child: "Ελένη", age: 7, name: "Πέτρος Λ.", phone: "6902020202" });
    // 3) Νίκος: επέτειος σε 30 ημέρες αλλά έχει ήδη κλείσει ξανά για φέτος.
    const n = await party({ title: "Πάρτι Νίκου", date: partyDateFor(30), child: "Νίκος", age: 4, name: "Σοφία Μ.", phone: "6903030303" });
    await setCustomerConsent(n.customerId!, true, admin.id);
    await party({ title: "Πάρτι Νίκου φέτος", date: addDays(today, 28), status: "confirmed", child: "ΝΙΚΟΣ", age: 5, name: "Σοφία Μ.", phone: "6903030303" });
    // 4) Άρης: επέτειος σε 90 ημέρες (εκτός των 60).
    await party({ title: "Πάρτι Άρη", date: partyDateFor(90), child: "Άρης", age: 6, name: "Γιάννης Π.", phone: "6904040404" });
    // 5) Χωρίς όνομα παιδιού, ακυρωμένο, και αίτημα που δεν έγινε ποτέ: δεν δίνουν γραμμή.
    await party({ title: "Πάρτι χωρίς όνομα", date: partyDateFor(10), name: "Κώστας", phone: "6905050505" });
    await party({ title: "Ακυρωμένο πέρσι", date: partyDateFor(15), status: "cancelled", child: "Ζωή", age: 3, name: "Ντίνα", phone: "6906060606" });
    await party({ title: "Αίτημα πέρσι", date: partyDateFor(16), status: "inquiry", child: "Λίνα", age: 3, name: "Ρούλα", phone: "6907070707" });
    // 6) Δύο αδέλφια: η νέα κράτηση της Δάφνης δεν κρύβει τον Παύλο.
    const p = await party({ title: "Πάρτι Παύλου", date: partyDateFor(50), child: "Παύλος", age: 8, name: "Ιωάννα Β.", phone: "6908080808" });
    await setCustomerConsent(p.customerId!, true, admin.id);
    await party({ title: "Πάρτι Δάφνης φέτος", date: addDays(today, 45), status: "confirmed", child: "Δάφνη", age: 4, name: "Ιωάννα Β.", phone: "6908080808" });
    // 7) Μίλτος: δύο πάρτι (πρόπερσι και πέρσι) → μία γραμμή, από το πιο πρόσφατο.
    await party({ title: "Πάρτι Μίλτου 1", date: partyDateFor(25, 2), child: "Μίλτος", age: 3, name: "Όλγα Τ.", phone: "6909090909" });
    const m2 = await party({ title: "Πάρτι Μίλτου 2", date: partyDateFor(25, 1), child: "Μιλτος", age: 4, name: "Όλγα Τ.", phone: "6909090909" });
    // 8) Χωρίς τηλέφωνο: γραμμή χωρίς στοιχεία επικοινωνίας.
    await party({ title: "Πάρτι Στέλιου", date: partyDateFor(5), child: "Στέλιος", name: "Βάσω" });

    const rows = await upcomingBirthdays(60, today);
    expect(rows.map((r) => r.childName)).toEqual(["Στέλιος", "Γιώργος", "Μιλτος", "Ελένη", "Παύλος"]);
    expect(rows.map((r) => r.daysUntil)).toEqual([...rows.map((r) => r.daysUntil)].sort((a, b) => a - b));

    const giorgos = rows.find((r) => r.childName === "Γιώργος")!;
    expect(giorgos).toMatchObject({ eventId: g.id, turningAge: 6, parentName: "Μαρία Κ.", phone: "6901010101", consent: true, lastPartyDate: g.date });
    expect(giorgos.anniversary).toBe(nextAnniversary(g.date, today));
    expect(giorgos.daysUntil).toBeGreaterThanOrEqual(19);
    expect(giorgos.daysUntil).toBeLessThanOrEqual(20);

    // Χωρίς συγκατάθεση: η γραμμή υπάρχει αλλά ΧΩΡΙΣ τηλέφωνο.
    expect(rows.find((r) => r.childName === "Ελένη")).toMatchObject({ consent: false, phone: null, turningAge: 8, parentName: "Πέτρος Λ." });
    expect(rows.find((r) => r.childName === "Στέλιος")).toMatchObject({ consent: false, phone: null, turningAge: null });
    expect(rows.find((r) => r.childName === "Μιλτος")).toMatchObject({ eventId: m2.id, turningAge: 5, consent: false });
    expect(rows.find((r) => r.childName === "Παύλος")).toMatchObject({ consent: true, turningAge: 9 });

    // Αν η φετινή κράτηση του Νίκου ακυρωθεί, ξαναμπαίνει στη λίστα.
    const again = (await db.query.events.findFirst({ where: eq(schema.events.title, "Πάρτι Νίκου φέτος") }))!;
    await setEventStatus(again.id, "cancelled", admin.id);
    expect((await upcomingBirthdays(60, today)).find((r) => r.childName === "Νίκος")).toMatchObject({ consent: true, turningAge: 5, phone: "6903030303" });
    // Ανάκληση συγκατάθεσης: χάνονται τα στοιχεία επικοινωνίας.
    await setCustomerConsent(g.customerId!, false, admin.id);
    expect((await upcomingBirthdays(60, today)).find((r) => r.childName === "Γιώργος")).toMatchObject({ consent: false, phone: null });
    // Μεγαλύτερο παράθυρο πιάνει και τον Άρη.
    expect((await upcomingBirthdays(120, today)).some((r) => r.childName === "Άρης")).toBe(true);
    // Αίτημα (και χωρίς όνομα παιδιού) από τον ίδιο πελάτη: είναι ήδη σε επαφή, δεν του στέλνουμε υπενθύμιση.
    await party({ title: "Αίτημα από site: Ιωάννα Β.", date: addDays(today, 70), status: "inquiry", name: "Ιωάννα Β.", phone: "6908080808" });
    expect((await upcomingBirthdays(60, today)).some((r) => r.childName === "Παύλος")).toBe(false);

    expect(birthdayText({ childName: "Γιώργος", turningAge: 6 })).toContain("(Γιώργος, γίνεται 6)");
    expect(birthdayText({ childName: "Ελένη", turningAge: null })).toContain("(Ελένη)");
    expect(await pendingWebsiteRequests()).toHaveLength(0);
  });
});
