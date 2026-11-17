/**
 * Βασικό μενού μπαρ με ΕΝΔΕΙΚΤΙΚΕΣ τιμές (ο διαχειριστής τις διορθώνει στο Μενού).
 * Φορτώνεται με το κουμπί «Φόρτωση βασικού μενού». Δεν διπλοπερνά: είδος με ίδιο όνομα στην ίδια κατηγορία αγνοείται.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

type Row = [name: string, cents: number];
/** ΦΠΑ: 13% εστίαση/μη αλκοολούχα, 24% αλκοολούχα. Ο λογιστής επιβεβαιώνει. */
export const STARTER_MENU: { category: string; color: string; station: "bar" | "kitchen"; vat: 13 | 24; items: Row[] }[] = [
  {
    category: "Καφέδες", color: "#6b4f2a", station: "bar", vat: 13,
    items: [["Espresso", 250], ["Espresso διπλός", 300], ["Freddo Espresso", 350], ["Cappuccino", 350], ["Cappuccino διπλός", 400], ["Freddo Cappuccino", 380], ["Ελληνικός", 250], ["Ελληνικός διπλός", 300], ["Φραπέ", 300], ["Φίλτρου", 300], ["Latte", 380], ["Americano", 300]],
  },
  {
    category: "Ροφήματα", color: "#a16207", station: "bar", vat: 13,
    items: [["Σοκολάτα ζεστή", 400], ["Σοκολάτα κρύα", 400], ["Τσάι ζεστό", 300], ["Χαμομήλι", 300], ["Φρέσκος χυμός πορτοκάλι", 450], ["Γάλα", 200]],
  },
  {
    category: "Αναψυκτικά & Τσάι", color: "#1d4ed8", station: "bar", vat: 13,
    items: [["Coca-Cola 330ml", 300], ["Coca-Cola Zero 330ml", 300], ["Fanta πορτοκαλάδα 330ml", 300], ["Fanta λεμονάδα 330ml", 300], ["Sprite 330ml", 300], ["Σόδα 330ml", 250], ["Ice Tea ροδάκινο", 300], ["Ice Tea λεμόνι", 300], ["Χυμός (κουτί)", 250], ["Νερό 500ml", 50], ["Νερό 1lt", 100], ["Ανθρακούχο νερό", 250]],
  },
  {
    category: "Μπύρες", color: "#ca8a04", station: "bar", vat: 24,
    items: [["Μπύρα βαρέλι 300ml", 400], ["Μπύρα βαρέλι 500ml", 500], ["Μπύρα φιάλη 330ml", 450], ["Μπύρα χωρίς αλκοόλ", 400], ["Radler", 450]],
  },
  {
    category: "Ποτά", color: "#6d28d9", station: "bar", vat: 24,
    items: [["Βότκα", 700], ["Τζιν", 700], ["Ρούμι", 700], ["Ουίσκι", 700], ["Ουίσκι premium", 900], ["Τεκίλα", 700], ["Κρασί ποτήρι (λευκό)", 500], ["Κρασί ποτήρι (κόκκινο)", 500], ["Κρασί ποτήρι (ροζέ)", 500], ["Ούζο / Τσίπουρο 200ml", 800], ["Σφηνάκι", 300]],
  },
  {
    category: "Cocktail", color: "#db2777", station: "bar", vat: 24,
    items: [["Mojito", 900], ["Aperol Spritz", 900], ["Margarita", 900], ["Daiquiri φράουλα", 900], ["Piña Colada", 900], ["Cosmopolitan", 900], ["Gin Tonic", 800], ["Negroni", 900], ["Paloma", 900], ["Mocktail (χωρίς αλκοόλ)", 700]],
  },
];

export async function loadStarterMenu(): Promise<{ categories: number; products: number }> {
  const db = await getDb();
  const [vats, stations, cats] = await Promise.all([db.select().from(schema.vatRates), db.select().from(schema.printStations), db.select().from(schema.categories)]);
  const vatId = (pct: number) => vats.find((v) => Number(v.ratePct) === pct)?.id;
  const stationId = (kind: "bar" | "kitchen") => stations.find((s) => s.kind === kind)?.id ?? null;
  let newCats = 0;
  let newProducts = 0;
  let sortBase = cats.reduce((m, c) => Math.max(m, c.sort), 0);
  for (const group of STARTER_MENU) {
    const vat = vatId(group.vat);
    if (!vat) throw new Error(`Λείπει ο συντελεστής ΦΠΑ ${group.vat}% (Ρυθμίσεις)`);
    let cat = cats.find((c) => c.name === group.category);
    if (!cat) {
      [cat] = await db.insert(schema.categories).values({ name: group.category, color: group.color, sort: ++sortBase, printStationId: stationId(group.station) }).returning();
      newCats++;
    } else if (!cat.active) {
      await db.update(schema.categories).set({ active: true }).where(eq(schema.categories.id, cat.id));
    }
    const existing = await db.select({ name: schema.products.name }).from(schema.products).where(and(eq(schema.products.categoryId, cat.id), eq(schema.products.active, true)));
    const have = new Set(existing.map((p) => p.name));
    const rows = group.items.filter(([name]) => !have.has(name)).map(([name, cents], i) => ({ categoryId: cat!.id, name, priceCents: cents, vatRateId: vat, sort: i + 1 }));
    if (rows.length) {
      await db.insert(schema.products).values(rows);
      newProducts += rows.length;
    }
  }
  return { categories: newCats, products: newProducts };
}
