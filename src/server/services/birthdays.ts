/**
 * «Γενέθλια που πλησιάζουν»: παιδιά που έκαναν πάρτι εδώ και η επέτειος του πάρτι τους πέφτει στις επόμενες ημέρες,
 * χωρίς να έχουν κλείσει ξανά για φέτος. Στοιχεία επικοινωνίας δίνονται μόνο με συγκατάθεση του πελάτη.
 */
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { daysBetween, nextAnniversary, type BirthdayRow } from "@/components/admin/bookings/meta";
import { addDays, todayAthens } from "./reports";

/** Πάρτι παλαιότερα από τόσα χρόνια δεν δίνουν υπενθύμιση (το παιδί έχει μεγαλώσει, ο πελάτης έχει χαθεί). */
const MAX_YEARS_BACK = 3;

/** Σύγκριση ονομάτων χωρίς τόνους/κεφαλαία ("Γιώργος" = "γιωργος"). */
function nameKey(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("el");
}

export async function upcomingBirthdays(days = 60, today: string = todayAthens()): Promise<BirthdayRow[]> {
  const db = await getDb();
  const since = addDays(today, -(MAX_YEARS_BACK * 366));
  const parties = await db.query.events.findMany({
    where: and(eq(schema.events.type, "party"), ne(schema.events.status, "cancelled"), gte(schema.events.date, since)),
    orderBy: [schema.events.date],
  });
  const customerIds = [...new Set(parties.map((p) => p.customerId).filter((x): x is number => x != null))];
  const customers = customerIds.length ? await db.select().from(schema.customers).where(inArray(schema.customers.id, customerIds)) : [];
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // Ο «πελάτης» μιας κράτησης: εγγραφή πελατολογίου, αλλιώς τηλέφωνο, αλλιώς όνομα.
  const ownerKey = (e: (typeof parties)[number]) => {
    if (e.customerId != null) return `c:${e.customerId}`;
    const phone = normalizePhone(e.customerPhone);
    if (isValidPhone(phone)) return `p:${phone}`;
    const name = nameKey(e.customerName);
    return name ? `n:${name}` : `e:${e.id}`;
  };

  const byOwner = new Map<string, typeof parties>();
  for (const p of parties) {
    const k = ownerKey(p);
    const list = byOwner.get(k) ?? [];
    list.push(p);
    byOwner.set(k, list);
  }

  const rows: BirthdayRow[] = [];
  for (const list of byOwner.values()) {
    // Κρατήσεις από σήμερα και μετά: ο πελάτης έχει ήδη κλείσει (ή ζητήσει) πάρτι.
    const upcoming = list.filter((p) => p.date >= today);
    const rebookedAll = upcoming.some((p) => !nameKey(p.party?.childName));
    const rebookedNames = new Set(upcoming.map((p) => nameKey(p.party?.childName)).filter(Boolean));
    // Τελευταίο πάρτι που έγινε, ανά παιδί.
    const lastByChild = new Map<string, (typeof parties)[number]>();
    for (const p of list) {
      if (p.date >= today || (p.status !== "confirmed" && p.status !== "done")) continue;
      const child = nameKey(p.party?.childName);
      if (!child) continue;
      const prev = lastByChild.get(child);
      if (!prev || p.date > prev.date) lastByChild.set(child, p);
    }
    for (const [child, last] of lastByChild) {
      if (rebookedAll || rebookedNames.has(child)) continue;
      const anniversary = nextAnniversary(last.date, today);
      const daysUntil = daysBetween(today, anniversary);
      if (daysUntil < 0 || daysUntil > days) continue;
      const years = Number(anniversary.slice(0, 4)) - Number(last.date.slice(0, 4));
      const age = last.party?.childAge;
      const customer = last.customerId != null ? customerById.get(last.customerId) : undefined;
      const consent = customer?.marketingConsent === true;
      rows.push({
        eventId: last.id,
        childName: (last.party?.childName ?? "").trim(),
        turningAge: typeof age === "number" && age > 0 ? age + years : null,
        lastPartyDate: last.date,
        anniversary,
        daysUntil,
        parentName: customer?.name || last.customerName,
        // Χωρίς συγκατάθεση δεν δίνουμε τηλέφωνο: η γραμμή φαίνεται μόνο ενημερωτικά.
        phone: consent ? (customer?.phone ?? null) : null,
        consent,
      });
    }
  }
  return rows.sort((a, b) => a.daysUntil - b.daysUntil || a.childName.localeCompare(b.childName, "el"));
}
