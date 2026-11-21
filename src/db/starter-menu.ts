/**
 * Βασικά μενού με ΕΝΔΕΙΚΤΙΚΕΣ τιμές (ο διαχειριστής τις διορθώνει στο Μενού):
 * - STARTER_MENU: μπαρ (κουμπί «Φόρτωση βασικού μενού»)
 * - KITCHEN_MENU: κουζίνα self-service σε χάρτινες συσκευασίες (κουμπί «Φόρτωση μενού κουζίνας»)
 * Δεν διπλοπερνά: είδος με ίδιο όνομα στην ίδια κατηγορία αγνοείται, και τίποτα υπάρχον δεν αλλάζει.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Όνομα, τιμή σε λεπτά και (προαιρετικά) ομάδες επιλογών, π.χ. ["fries"] για «Με πατάτες». */
type Row = [name: string, cents: number, options?: OptionKey[]];
type MenuGroup = { category: string; color: string; station: "bar" | "kitchen"; vat: 13 | 24; items: Row[] };

/** Ομάδες επιλογών του μενού κουζίνας (προαιρετικές, μία επιλογή). */
export const MENU_OPTIONS = {
  fries: { name: "Πατάτες", options: [["Με πατάτες", 200]] },
  friesSmall: { name: "Πατάτες (μικρή μερίδα)", options: [["Με μικρή μερίδα πατάτες", 150]] },
} as const satisfies Record<string, { name: string; options: readonly (readonly [string, number])[] }>;
type OptionKey = keyof typeof MENU_OPTIONS;

/** ΦΠΑ: 13% εστίαση/μη αλκοολούχα, 24% αλκοολούχα. Ο λογιστής επιβεβαιώνει. */
export const STARTER_MENU: MenuGroup[] = [
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

/**
 * Κουζίνα self-service: όλα σερβίρονται σε χάρτινες συσκευασίες. Τιμές ΕΝΔΕΙΚΤΙΚΕΣ (2026, οικογενειακό κατάστημα
 * στα περίχωρα της Θεσσαλονίκης)· οριστικοποιούνται αφού μπουν συνταγές και κόστος συσκευασίας στην Κοστολόγηση.
 */
export const KITCHEN_MENU: MenuGroup[] = [
  {
    category: "Πίτσες", color: "#b91c1c", station: "kitchen", vat: 13,
    items: [["Πίτσα Μαργαρίτα", 950], ["Πίτσα Πεπερόνι", 1100], ["Πίτσα Special", 1150], ["Πίτσα Tartufo", 1250]],
  },
  {
    category: "Burgers", color: "#9a3412", station: "kitchen", vat: 13,
    items: [
      // Μοσχαρίσιο μπιφτέκι 190 γρ. σε ψωμάκι brioche.
      ["Classic Burger 190γρ", 950, ["fries"]],
      ["BBQ Bacon Burger 190γρ", 1050, ["fries"]],
      ["Truffle Mushroom Burger 190γρ", 1100, ["fries"]],
      // Smash: διπλό λεπτό μπιφτέκι, ψημένο πατητό στη πλάκα.
      ["Smash Burger", 900, ["fries"]],
      ["Smash Bacon Burger", 1000, ["fries"]],
      ["Smash Spicy Burger", 950, ["fries"]],
    ],
  },
  {
    category: "Mini Burgers", color: "#ea580c", station: "kitchen", vat: 13,
    items: [["Mini Burger κλασικό", 450, ["friesSmall"]], ["Mini Cheeseburger", 500, ["friesSmall"]], ["Mini Chicken Burger", 500, ["friesSmall"]]],
  },
  {
    category: "Hot Dog", color: "#d97706", station: "kitchen", vat: 13,
    items: [["Mini Hot Dog (φρανκφούρτης)", 350, ["friesSmall"]], ["Hot Dog XL (χωριάτικο λουκάνικο)", 650, ["fries"]]],
  },
  {
    category: "Σαλάτες", color: "#15803d", station: "kitchen", vat: 13,
    items: [["Σαλάτα Caesar's", 850], ["Ελληνική σαλάτα", 800], ["Σαλάτα με σολομό", 1050]],
  },
  {
    category: "Brunch", color: "#ca8a04", station: "kitchen", vat: 13,
    items: [
      ["Pancakes Nutella & μπανάνα", 750],
      ["Pancakes φράουλα & σιρόπι", 750],
      ["Pancakes μπέικον & αυγό", 850],
      ["Pancakes γαλοπούλα & cheddar", 800],
      ["Croque Madame", 850],
      ["Αυγά Benedict", 950],
      ["Scrambled eggs με προζύμι", 700],
      ["Ομελέτα", 700],
    ],
  },
  {
    category: "Σνακ & Σάντουιτς", color: "#a16207", station: "kitchen", vat: 13,
    items: [["Κοτομπουκιές", 700, ["fries"]], ["Τοστ γαλοπούλα-τυρί", 350], ["Club Sandwich (με πατάτες)", 900], ["Club κοτόπουλο (με πατάτες)", 950], ["Μερίδα πατάτες", 350]],
  },
  {
    category: "Vegan", color: "#4d7c0f", station: "kitchen", vat: 13,
    items: [["Vegan πανίνι λαχανικά σχάρας & χούμους", 700], ["Vegan πανίνι φαλάφελ & ταχίνι", 750], ["Vegan πανίνι μανιτάρια & vegan τυρί", 750]],
  },
];

/** Φορτώνει ένα βασικό μενού: νέες κατηγορίες/είδη/ομάδες επιλογών, ποτέ αλλαγή σε κάτι που υπάρχει. */
async function loadMenu(menu: MenuGroup[]): Promise<{ categories: number; products: number }> {
  const db = await getDb();
  const [vats, stations, cats, groups] = await Promise.all([
    db.select().from(schema.vatRates),
    db.select().from(schema.printStations),
    db.select().from(schema.categories),
    db.select().from(schema.modifierGroups),
  ]);
  const vatId = (pct: number) => vats.find((v) => Number(v.ratePct) === pct && v.active)?.id ?? vats.find((v) => Number(v.ratePct) === pct)?.id;
  const stationId = (kind: "bar" | "kitchen") => {
    const st = stations.find((s) => s.kind === kind && s.enabled) ?? stations.find((s) => s.kind === kind);
    if (!st) throw new Error(kind === "kitchen" ? "Δεν υπάρχει σταθμός κουζίνας (Διαχείριση → Εκτυπωτές). Χωρίς αυτόν οι παραγγελίες δεν θα τυπώνονται." : "Δεν υπάρχει σταθμός μπαρ (Διαχείριση → Εκτυπωτές).");
    return st.id;
  };
  // Ομάδες επιλογών: ξαναχρησιμοποιεί ενεργή ομάδα με το ίδιο όνομα, αλλιώς τη φτιάχνει (μόνο όταν χρειαστεί).
  const groupIds = new Map<OptionKey, number>();
  const groupFor = async (key: OptionKey) => {
    const known = groupIds.get(key);
    if (known) return known;
    const def = MENU_OPTIONS[key];
    let g = groups.find((x) => x.name === def.name && x.active);
    if (!g) {
      [g] = await db.insert(schema.modifierGroups).values({ name: def.name, minSelect: 0, maxSelect: 1 }).returning();
      await db.insert(schema.modifiers).values(def.options.map(([name, delta], i) => ({ groupId: g!.id, name, priceDeltaCents: delta, sort: i + 1 })));
    }
    groupIds.set(key, g.id);
    return g.id;
  };
  let newCats = 0;
  let newProducts = 0;
  let sortBase = cats.reduce((m, c) => Math.max(m, c.sort), 0);
  for (const group of menu) {
    const vat = vatId(group.vat);
    if (!vat) throw new Error(`Λείπει ο συντελεστής ΦΠΑ ${group.vat}% (Ρυθμίσεις)`);
    const station = stationId(group.station);
    let cat = cats.find((c) => c.name === group.category);
    if (!cat) {
      [cat] = await db.insert(schema.categories).values({ name: group.category, color: group.color, sort: ++sortBase, printStationId: station }).returning();
      newCats++;
    } else if (!cat.active) {
      await db.update(schema.categories).set({ active: true }).where(eq(schema.categories.id, cat.id));
    }
    const existing = await db.select({ name: schema.products.name }).from(schema.products).where(and(eq(schema.products.categoryId, cat.id), eq(schema.products.active, true)));
    const have = new Set(existing.map((p) => p.name));
    const items = group.items.filter(([name]) => !have.has(name));
    if (!items.length) continue;
    const inserted = await db
      .insert(schema.products)
      .values(items.map(([name, cents], i) => ({ categoryId: cat!.id, name, priceCents: cents, vatRateId: vat, sort: existing.length + i + 1 })))
      .returning({ id: schema.products.id, name: schema.products.name });
    newProducts += inserted.length;
    const links: { productId: number; groupId: number; sort: number }[] = [];
    for (const [name, , options] of items) {
      const product = inserted.find((p) => p.name === name);
      if (!product || !options?.length) continue;
      for (const [i, key] of options.entries()) links.push({ productId: product.id, groupId: await groupFor(key), sort: i + 1 });
    }
    if (links.length) await db.insert(schema.productModifierGroups).values(links);
  }
  return { categories: newCats, products: newProducts };
}

export function loadStarterMenu() {
  return loadMenu(STARTER_MENU);
}

export function loadKitchenMenu() {
  return loadMenu(KITCHEN_MENU);
}
