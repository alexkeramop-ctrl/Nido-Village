/**
 * Δείγμα δεδομένων για το Nido Village. Τρέχει μόνο αν η βάση είναι άδεια.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./index";
import * as schema from "./schema";
import { encryptPin, hashPin } from "@/server/pin";

export async function seedDemo(db: Db): Promise<boolean> {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(schema.employees);
  if ((existing[0]?.n ?? 0) > 0) return false;

  const emp = (name: string, role: schema.EmployeeRole, pin: string) => ({ name, role, pinHash: hashPin(pin), pinEncrypted: encryptPin(pin) });
  await db.insert(schema.employees).values([
    emp("Αλέξης", "admin", "1234"),
    emp("Ελένη", "manager", "4444"),
    emp("Νίκος", "cashier", "2222"),
    emp("Μαρία", "waiter", "1111"),
    emp("Κατερίνα (Μπαρ Κέντρο)", "waiter", "3333"),
    emp("Γιώργος (Μπαρ Παιδική)", "waiter", "5555"),
  ]);

  const [vat13, vat24] = await db
    .insert(schema.vatRates)
    .values([
      { name: "Μειωμένος 13%", ratePct: "13.00", mydataCategory: 2 },
      { name: "Κανονικός 24%", ratePct: "24.00", mydataCategory: 1 },
      { name: "Υπερμειωμένος 6%", ratePct: "6.00", mydataCategory: 3 },
      { name: "Απαλλαγή 0%", ratePct: "0.00", mydataCategory: 7 },
    ])
    .returning();

  const [kitchen, barKentro, barPaidiki] = await db
    .insert(schema.printStations)
    .values([
      { name: "Κουζίνα", kind: "kitchen", driver: "console", sort: 1 },
      { name: "Μπαρ Κέντρο", kind: "bar", driver: "console", sort: 2 },
      { name: "Μπαρ Παιδική", kind: "bar", driver: "console", sort: 3 },
      { name: "Ταμείο", kind: "receipt", driver: "console", sort: 4, drawerKick: true },
    ])
    .returning();

  // Χάρτης χώρου: η αεροφωτογραφία του Nido Village ως φόντο (918x1713).
  let mapAssetId: number | null = null;
  try {
    const img = fs.readFileSync(path.join(process.cwd(), "src", "db", "seed-assets", "nido-aerial.jpg"));
    const [asset] = await db
      .insert(schema.assets)
      .values({ kind: "map", mime: "image/jpeg", data: img.toString("base64"), width: 918, height: 1713 })
      .returning();
    mapAssetId = asset.id;
  } catch {
    mapAssetId = null;
  }

  // Χώροι: «Κέντρο» (κτίριο, πισίνα, πέργκολες) και «Παιδική» (τραπέζια στον παιδότοπο). Κάθε χώρος έχει το μπαρ του.
  const [kentro, paidiki] = await db
    .insert(schema.areas)
    .values([
      { name: "Κέντρο", sort: 1, mapAssetId, barStationId: barKentro.id },
      { name: "Παιδική", sort: 2, mapAssetId, barStationId: barPaidiki.id },
    ])
    .returning();
  const pos = (x: number, y: number) => ({ posX: Math.round((x / 918) * 1000), posY: Math.round((y / 1713) * 1000) });
  const kentroPos: [number, number][] = [
    [372, 250], [372, 300], [372, 350], [400, 235], [455, 235], [510, 235],
    [560, 250], [560, 300], [560, 350], [420, 365], [470, 370], [520, 365],
    [590, 285], [590, 335], [345, 300], [345, 355],
    [275, 405], [275, 450], [275, 495], [275, 540],
    [440, 545], [490, 550], [540, 550], [590, 545], [630, 500],
    [320, 605], [370, 615], [420, 625], [470, 630], [520, 630],
  ];
  const paidikiPos: [number, number][] = [
    [530, 690], [565, 690], [600, 690], [635, 690],
    [530, 725], [565, 725], [600, 725], [635, 725],
    [530, 760], [565, 760], [600, 760], [635, 760],
    [300, 1020], [300, 1070], [300, 1120],
    [420, 1165], [475, 1170], [530, 1175], [585, 1180], [640, 1185],
  ];
  const tableRows: (typeof schema.tables.$inferInsert)[] = [];
  for (let i = 1; i <= 30; i++)
    tableRows.push({ areaId: kentro.id, name: `Κ${i}`, seats: i % 5 === 0 ? 6 : 4, sort: i, shape: i > 16 && i <= 20 ? "wide" : "round", ...pos(...kentroPos[i - 1]) });
  for (let i = 1; i <= 20; i++)
    tableRows.push({ areaId: paidiki.id, name: `Π${i}`, seats: 6, sort: i, shape: i > 12 && i <= 15 ? "wide" : "round", ...pos(...paidikiPos[i - 1]) });
  await db.insert(schema.tables).values(tableRows);

  // Κατηγορίες: ροφήματα στο μπαρ (του χώρου), φαγητά στην κουζίνα.
  const cats = await db
    .insert(schema.categories)
    .values([
      { name: "Καφέδες", sort: 1, color: "#6b4f2a", printStationId: barKentro.id },
      { name: "Αναψυκτικά", sort: 2, color: "#1d4ed8", printStationId: barKentro.id },
      { name: "Smoothies", sort: 3, color: "#be185d", printStationId: barKentro.id },
      { name: "Παγωτά", sort: 4, color: "#7c3aed", printStationId: barKentro.id },
      { name: "Burger", sort: 5, color: "#b45309", printStationId: kitchen.id },
      { name: "Πίτσα", sort: 6, color: "#dc2626", printStationId: kitchen.id },
      { name: "Club Sandwich", sort: 7, color: "#15803d", printStationId: kitchen.id },
      { name: "Ποτά", sort: 8, color: "#6d28d9", printStationId: barKentro.id },
    ])
    .returning();
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const P = (categoryId: number, name: string, price: number, vatRateId: number, sort = 0) => ({ categoryId, name, priceCents: price, vatRateId, sort });
  const products = await db
    .insert(schema.products)
    .values([
      P(cat("Καφέδες"), "Espresso", 200, vat13.id, 1),
      P(cat("Καφέδες"), "Espresso διπλός", 250, vat13.id, 2),
      P(cat("Καφέδες"), "Cappuccino", 300, vat13.id, 3),
      P(cat("Καφέδες"), "Freddo Espresso", 300, vat13.id, 4),
      P(cat("Καφέδες"), "Freddo Cappuccino", 350, vat13.id, 5),
      P(cat("Καφέδες"), "Ελληνικός", 200, vat13.id, 6),
      P(cat("Καφέδες"), "Φραπέ", 300, vat13.id, 7),
      P(cat("Καφέδες"), "Latte", 350, vat13.id, 8),
      P(cat("Καφέδες"), "Τσάι", 250, vat13.id, 9),
      P(cat("Καφέδες"), "Ζεστή σοκολάτα", 350, vat13.id, 10),
      P(cat("Αναψυκτικά"), "Νερό 500ml", 50, vat13.id, 1),
      P(cat("Αναψυκτικά"), "Νερό 1L", 100, vat13.id, 2),
      P(cat("Αναψυκτικά"), "Coca-Cola 330ml", 250, vat24.id, 3),
      P(cat("Αναψυκτικά"), "Coca-Cola Zero 330ml", 250, vat24.id, 4),
      P(cat("Αναψυκτικά"), "Sprite 330ml", 250, vat24.id, 5),
      P(cat("Αναψυκτικά"), "Πορτοκαλάδα 330ml", 250, vat24.id, 6),
      P(cat("Αναψυκτικά"), "Ice Tea 330ml", 250, vat24.id, 7),
      P(cat("Αναψυκτικά"), "Φρέσκος χυμός πορτοκάλι", 400, vat13.id, 8),
      P(cat("Αναψυκτικά"), "Μπύρα Fix 500ml", 450, vat24.id, 9),
      P(cat("Αναψυκτικά"), "Μπύρα Alfa 330ml", 400, vat24.id, 10),
      P(cat("Smoothies"), "Φράουλα & Μπανάνα", 500, vat13.id, 1),
      P(cat("Smoothies"), "Μάνγκο & Ανανάς", 500, vat13.id, 2),
      P(cat("Smoothies"), "Πράσινο (σπανάκι, μήλο, αγγούρι)", 550, vat13.id, 3),
      P(cat("Smoothies"), "Σοκολάτα & Μπανάνα", 500, vat13.id, 4),
      P(cat("Παγωτά"), "Παγωτό 1 μπάλα", 200, vat13.id, 1),
      P(cat("Παγωτά"), "Παγωτό 2 μπάλες", 350, vat13.id, 2),
      P(cat("Παγωτά"), "Παγωτό 3 μπάλες", 500, vat13.id, 3),
      P(cat("Παγωτά"), "Παγωτό ξυλάκι", 250, vat13.id, 4),
      P(cat("Burger"), "Classic Burger", 850, vat13.id, 1),
      P(cat("Burger"), "Cheeseburger", 900, vat13.id, 2),
      P(cat("Burger"), "Bacon Burger", 950, vat13.id, 3),
      P(cat("Burger"), "Chicken Burger", 850, vat13.id, 4),
      P(cat("Burger"), "Kids Burger", 650, vat13.id, 5),
      P(cat("Πίτσα"), "Μαργαρίτα", 900, vat13.id, 1),
      P(cat("Πίτσα"), "Special", 1100, vat13.id, 2),
      P(cat("Πίτσα"), "Πεπερόνι", 1050, vat13.id, 3),
      P(cat("Πίτσα"), "4 Τυριά", 1100, vat13.id, 4),
      P(cat("Πίτσα"), "Kids Πίτσα", 700, vat13.id, 5),
      P(cat("Club Sandwich"), "Club Sandwich κοτόπουλο", 800, vat13.id, 1),
      P(cat("Club Sandwich"), "Club Sandwich ζαμπόν-τυρί", 750, vat13.id, 2),
      P(cat("Club Sandwich"), "Club Sandwich vegetarian", 700, vat13.id, 3),
      P(cat("Club Sandwich"), "Τοστ ζαμπόν-τυρί", 350, vat13.id, 4),
      P(cat("Ποτά"), "Βότκα (ποτό)", 700, vat24.id, 1),
      P(cat("Ποτά"), "Ουίσκι (ποτό)", 800, vat24.id, 2),
      P(cat("Ποτά"), "Gin Tonic", 800, vat24.id, 3),
    ])
    .returning();
  const prod = (name: string) => products.find((p) => p.name === name)!.id;

  const [gSugar, gMilk, gFlavor, gBurger, gPizza] = await db
    .insert(schema.modifierGroups)
    .values([
      { name: "Ζάχαρη", minSelect: 0, maxSelect: 1 },
      { name: "Γάλα", minSelect: 0, maxSelect: 1 },
      { name: "Γεύση παγωτού", minSelect: 1, maxSelect: 3 },
      { name: "Extras burger", minSelect: 0, maxSelect: 3 },
      { name: "Extras πίτσας", minSelect: 0, maxSelect: 3 },
    ])
    .returning();
  const mods = await db
    .insert(schema.modifiers)
    .values([
      { groupId: gSugar.id, name: "Σκέτος", sort: 1 },
      { groupId: gSugar.id, name: "Μέτριος", sort: 2 },
      { groupId: gSugar.id, name: "Γλυκός", sort: 3 },
      { groupId: gMilk.id, name: "Κανονικό γάλα", sort: 1 },
      { groupId: gMilk.id, name: "Χωρίς λακτόζη", priceDeltaCents: 30, sort: 2 },
      { groupId: gMilk.id, name: "Αμυγδάλου", priceDeltaCents: 50, sort: 3 },
      { groupId: gFlavor.id, name: "Βανίλια", sort: 1 },
      { groupId: gFlavor.id, name: "Σοκολάτα", sort: 2 },
      { groupId: gFlavor.id, name: "Φράουλα", sort: 3 },
      { groupId: gFlavor.id, name: "Καραμέλα", sort: 4 },
      { groupId: gFlavor.id, name: "Φιστίκι", sort: 5 },
      { groupId: gBurger.id, name: "Extra τυρί", priceDeltaCents: 100, sort: 1 },
      { groupId: gBurger.id, name: "Extra bacon", priceDeltaCents: 150, sort: 2 },
      { groupId: gBurger.id, name: "Χωρίς κρεμμύδι", sort: 3 },
      { groupId: gBurger.id, name: "Χωρίς ντομάτα", sort: 4 },
      { groupId: gBurger.id, name: "Χωρίς σως", sort: 5 },
      { groupId: gPizza.id, name: "Extra μοτσαρέλα", priceDeltaCents: 100, sort: 1 },
      { groupId: gPizza.id, name: "Ζαμπόν", priceDeltaCents: 100, sort: 2 },
      { groupId: gPizza.id, name: "Μανιτάρια", priceDeltaCents: 100, sort: 3 },
      { groupId: gPizza.id, name: "Πιπεριές", priceDeltaCents: 50, sort: 4 },
    ])
    .returning();
  const mod = (name: string) => mods.find((m) => m.name === name)!.id;
  const link = (names: string[], groupId: number, sort = 0) => names.map((n) => ({ productId: prod(n), groupId, sort }));
  await db.insert(schema.productModifierGroups).values([
    ...link(["Espresso", "Espresso διπλός", "Cappuccino", "Freddo Espresso", "Freddo Cappuccino", "Ελληνικός", "Φραπέ", "Latte"], gSugar.id, 0),
    ...link(["Cappuccino", "Freddo Cappuccino", "Φραπέ", "Latte", "Ζεστή σοκολάτα"], gMilk.id, 1),
    ...link(["Παγωτό 1 μπάλα", "Παγωτό 2 μπάλες", "Παγωτό 3 μπάλες"], gFlavor.id, 0),
    ...link(["Classic Burger", "Cheeseburger", "Bacon Burger", "Chicken Burger", "Kids Burger"], gBurger.id, 0),
    ...link(["Μαργαρίτα", "Special", "Πεπερόνι", "4 Τυριά", "Kids Πίτσα"], gPizza.id, 0),
  ]);

  const [supCoffee, supDrinks, supMeat, supBakery, supVeg, supIce] = await db
    .insert(schema.suppliers)
    .values([
      { name: "Καφεκοπτείο Λουμίδης", phone: "2100000001" },
      { name: "Μάνος Ποτά ΑΕ", phone: "2100000002" },
      { name: "Κρεοπωλείο Παππάς", phone: "2100000003" },
      { name: "Φούρνος Κώστα", phone: "2100000004" },
      { name: "Λαχαναγορά Ρέντη", phone: "2100000005" },
      { name: "Παγωτά Δωδώνη", phone: "2100000006" },
    ])
    .returning();
  const I = (name: string, unit: schema.StockUnit, stock: number, min: number, cost: number, supplierId: number | null) => ({
    name,
    unit,
    stockQty: stock.toFixed(3),
    minQty: min.toFixed(3),
    costPerUnit: cost.toFixed(4),
    supplierId,
  });
  /** Πρώτη ύλη με συσκευασία και μερίδα (π.χ. μπουκάλι 700 ml, ποτό 60 ml) για έλεγχο απόκλισης στο μπαρ. */
  const B = (name: string, stock: number, min: number, cost: number, packSize: number, portionQty: number) => ({
    ...I(name, "ml" as const, stock, min, cost, supDrinks.id),
    packSize: packSize.toFixed(3),
    packName: "μπουκάλι",
    portionQty: portionQty.toFixed(3),
    portionName: "ποτό",
  });
  const ings = await db
    .insert(schema.ingredients)
    .values([
      I("Καφές espresso", "g", 3000, 500, 0.028, supCoffee.id),
      I("Καφές ελληνικός", "g", 1000, 200, 0.018, supCoffee.id),
      I("Καφές στιγμιαίος", "g", 1000, 200, 0.02, supCoffee.id),
      I("Κακάο", "g", 1000, 200, 0.015, supCoffee.id),
      I("Τσάι (φακελάκι)", "pcs", 100, 20, 0.12, supCoffee.id),
      I("Γάλα", "ml", 20000, 3000, 0.0013, supDrinks.id),
      I("Γάλα χωρίς λακτόζη", "ml", 3000, 500, 0.0025, supDrinks.id),
      I("Γάλα αμυγδάλου", "ml", 2000, 500, 0.004, supDrinks.id),
      I("Νερό 500ml", "pcs", 200, 48, 0.2, supDrinks.id),
      I("Νερό 1L", "pcs", 100, 24, 0.35, supDrinks.id),
      I("Coca-Cola 330ml", "pcs", 96, 24, 0.85, supDrinks.id),
      I("Coca-Cola Zero 330ml", "pcs", 48, 24, 0.85, supDrinks.id),
      I("Sprite 330ml", "pcs", 48, 24, 0.85, supDrinks.id),
      I("Πορτοκαλάδα 330ml", "pcs", 48, 24, 0.85, supDrinks.id),
      I("Ice Tea 330ml", "pcs", 48, 24, 0.9, supDrinks.id),
      I("Μπύρα Fix 500ml", "pcs", 72, 24, 1.4, supDrinks.id),
      I("Μπύρα Alfa 330ml", "pcs", 72, 24, 1.0, supDrinks.id),
      I("Πορτοκάλια", "g", 10000, 2000, 0.0012, supVeg.id),
      I("Φράουλες", "g", 3000, 500, 0.006, supVeg.id),
      I("Μπανάνες", "g", 5000, 1000, 0.0016, supVeg.id),
      I("Μάνγκο", "g", 2000, 500, 0.006, supVeg.id),
      I("Ανανάς", "g", 2000, 500, 0.004, supVeg.id),
      I("Σπανάκι", "g", 1000, 200, 0.003, supVeg.id),
      I("Μήλα", "g", 3000, 500, 0.0018, supVeg.id),
      I("Αγγούρι", "g", 2000, 500, 0.0012, supVeg.id),
      I("Μαρούλι", "g", 2000, 400, 0.002, supVeg.id),
      I("Ντομάτα", "g", 5000, 1000, 0.0018, supVeg.id),
      I("Κρεμμύδι", "g", 3000, 500, 0.001, supVeg.id),
      I("Πιπεριές", "g", 1500, 300, 0.0025, supVeg.id),
      I("Μανιτάρια", "g", 1500, 300, 0.005, supVeg.id),
      I("Παγωτό (μπάλες)", "pcs", 200, 40, 0.45, supIce.id),
      I("Παγωτό ξυλάκι", "pcs", 60, 12, 0.9, supIce.id),
      I("Ψωμάκι burger", "pcs", 80, 20, 0.35, supBakery.id),
      I("Ψωμί τοστ (φέτες)", "pcs", 200, 40, 0.08, supBakery.id),
      I("Ζύμη πίτσας 30cm", "pcs", 40, 10, 0.9, supBakery.id),
      I("Μπιφτέκι μοσχαρίσιο 150g", "pcs", 60, 15, 1.6, supMeat.id),
      I("Φιλέτο κοτόπουλο", "g", 6000, 1500, 0.0075, supMeat.id),
      I("Bacon", "g", 2000, 400, 0.012, supMeat.id),
      I("Ζαμπόν", "g", 3000, 600, 0.009, supMeat.id),
      I("Πεπερόνι", "g", 1500, 300, 0.014, supMeat.id),
      I("Τυρί cheddar (φέτες)", "pcs", 200, 40, 0.18, supDrinks.id),
      I("Τυρί gouda (φέτες)", "pcs", 200, 40, 0.15, supDrinks.id),
      I("Μοτσαρέλα", "g", 5000, 1000, 0.008, supDrinks.id),
      I("Μείγμα 4 τυριών", "g", 2000, 400, 0.011, supDrinks.id),
      I("Σάλτσα ντομάτας", "g", 5000, 1000, 0.0025, supVeg.id),
      I("Μαγιονέζα", "g", 2000, 400, 0.004, supVeg.id),
      I("Πατάτες προτηγανισμένες", "g", 20000, 4000, 0.0021, supVeg.id),
      B("Βότκα", 2100, 700, 0.02, 700, 60),
      B("Ουίσκι", 2100, 700, 0.03, 700, 60),
      B("Τζιν", 1400, 700, 0.022, 700, 50),
      I("Tonic 200ml", "pcs", 48, 12, 0.7, supDrinks.id),
    ])
    .returning();
  const ing = (name: string) => ings.find((i) => i.name === name)!.id;
  await db.insert(schema.stockMovements).values(
    ings.map((i) => ({ ingredientId: i.id, kind: "manual" as const, qtyDelta: i.stockQty, note: "Αρχικό απόθεμα (seed)" })),
  );

  const R = (productName: string, lines: [string, number][]) => lines.map(([n, q]) => ({ productId: prod(productName), ingredientId: ing(n), qty: q.toFixed(3) }));
  const M = (modifierName: string, lines: [string, number][]) => lines.map(([n, q]) => ({ modifierId: mod(modifierName), ingredientId: ing(n), qty: q.toFixed(3) }));
  const burgerBase: [string, number][] = [["Ψωμάκι burger", 1], ["Μπιφτέκι μοσχαρίσιο 150g", 1], ["Μαρούλι", 20], ["Ντομάτα", 30], ["Κρεμμύδι", 15], ["Πατάτες προτηγανισμένες", 150]];
  await db.insert(schema.recipeLines).values([
    ...R("Espresso", [["Καφές espresso", 8]]),
    ...R("Espresso διπλός", [["Καφές espresso", 16]]),
    ...R("Cappuccino", [["Καφές espresso", 8], ["Γάλα", 120]]),
    ...R("Freddo Espresso", [["Καφές espresso", 16]]),
    ...R("Freddo Cappuccino", [["Καφές espresso", 16], ["Γάλα", 100]]),
    ...R("Ελληνικός", [["Καφές ελληνικός", 10]]),
    ...R("Φραπέ", [["Καφές στιγμιαίος", 6], ["Γάλα", 50]]),
    ...R("Latte", [["Καφές espresso", 8], ["Γάλα", 200]]),
    ...R("Τσάι", [["Τσάι (φακελάκι)", 1]]),
    ...R("Ζεστή σοκολάτα", [["Κακάο", 25], ["Γάλα", 200]]),
    ...R("Νερό 500ml", [["Νερό 500ml", 1]]),
    ...R("Νερό 1L", [["Νερό 1L", 1]]),
    ...R("Coca-Cola 330ml", [["Coca-Cola 330ml", 1]]),
    ...R("Coca-Cola Zero 330ml", [["Coca-Cola Zero 330ml", 1]]),
    ...R("Sprite 330ml", [["Sprite 330ml", 1]]),
    ...R("Πορτοκαλάδα 330ml", [["Πορτοκαλάδα 330ml", 1]]),
    ...R("Ice Tea 330ml", [["Ice Tea 330ml", 1]]),
    ...R("Φρέσκος χυμός πορτοκάλι", [["Πορτοκάλια", 500]]),
    ...R("Μπύρα Fix 500ml", [["Μπύρα Fix 500ml", 1]]),
    ...R("Μπύρα Alfa 330ml", [["Μπύρα Alfa 330ml", 1]]),
    ...R("Φράουλα & Μπανάνα", [["Φράουλες", 120], ["Μπανάνες", 100], ["Γάλα", 100]]),
    ...R("Μάνγκο & Ανανάς", [["Μάνγκο", 120], ["Ανανάς", 100]]),
    ...R("Πράσινο (σπανάκι, μήλο, αγγούρι)", [["Σπανάκι", 50], ["Μήλα", 150], ["Αγγούρι", 100]]),
    ...R("Σοκολάτα & Μπανάνα", [["Κακάο", 15], ["Μπανάνες", 120], ["Γάλα", 150]]),
    ...R("Παγωτό 1 μπάλα", [["Παγωτό (μπάλες)", 1]]),
    ...R("Παγωτό 2 μπάλες", [["Παγωτό (μπάλες)", 2]]),
    ...R("Παγωτό 3 μπάλες", [["Παγωτό (μπάλες)", 3]]),
    ...R("Παγωτό ξυλάκι", [["Παγωτό ξυλάκι", 1]]),
    ...R("Classic Burger", burgerBase),
    ...R("Cheeseburger", [...burgerBase, ["Τυρί cheddar (φέτες)", 1]]),
    ...R("Bacon Burger", [...burgerBase, ["Τυρί cheddar (φέτες)", 1], ["Bacon", 30]]),
    ...R("Chicken Burger", [["Ψωμάκι burger", 1], ["Φιλέτο κοτόπουλο", 150], ["Μαρούλι", 20], ["Ντομάτα", 30], ["Μαγιονέζα", 15], ["Πατάτες προτηγανισμένες", 150]]),
    ...R("Kids Burger", [["Ψωμάκι burger", 1], ["Μπιφτέκι μοσχαρίσιο 150g", 1], ["Πατάτες προτηγανισμένες", 100]]),
    ...R("Μαργαρίτα", [["Ζύμη πίτσας 30cm", 1], ["Σάλτσα ντομάτας", 80], ["Μοτσαρέλα", 120]]),
    ...R("Special", [["Ζύμη πίτσας 30cm", 1], ["Σάλτσα ντομάτας", 80], ["Μοτσαρέλα", 120], ["Ζαμπόν", 40], ["Μανιτάρια", 40], ["Πιπεριές", 30]]),
    ...R("Πεπερόνι", [["Ζύμη πίτσας 30cm", 1], ["Σάλτσα ντομάτας", 80], ["Μοτσαρέλα", 110], ["Πεπερόνι", 50]]),
    ...R("4 Τυριά", [["Ζύμη πίτσας 30cm", 1], ["Σάλτσα ντομάτας", 60], ["Μοτσαρέλα", 80], ["Μείγμα 4 τυριών", 80]]),
    ...R("Kids Πίτσα", [["Ζύμη πίτσας 30cm", 1], ["Σάλτσα ντομάτας", 60], ["Μοτσαρέλα", 80]]),
    ...R("Club Sandwich κοτόπουλο", [["Ψωμί τοστ (φέτες)", 3], ["Φιλέτο κοτόπουλο", 100], ["Bacon", 20], ["Μαρούλι", 20], ["Ντομάτα", 30], ["Μαγιονέζα", 15], ["Πατάτες προτηγανισμένες", 120]]),
    ...R("Club Sandwich ζαμπόν-τυρί", [["Ψωμί τοστ (φέτες)", 3], ["Ζαμπόν", 50], ["Τυρί gouda (φέτες)", 2], ["Ντομάτα", 30], ["Μαγιονέζα", 15], ["Πατάτες προτηγανισμένες", 120]]),
    ...R("Club Sandwich vegetarian", [["Ψωμί τοστ (φέτες)", 3], ["Τυρί gouda (φέτες)", 2], ["Ντομάτα", 40], ["Μαρούλι", 20], ["Αγγούρι", 30], ["Μαγιονέζα", 15], ["Πατάτες προτηγανισμένες", 120]]),
    ...R("Τοστ ζαμπόν-τυρί", [["Ψωμί τοστ (φέτες)", 2], ["Ζαμπόν", 25], ["Τυρί gouda (φέτες)", 1]]),
    ...R("Βότκα (ποτό)", [["Βότκα", 60]]),
    ...R("Ουίσκι (ποτό)", [["Ουίσκι", 60]]),
    ...R("Gin Tonic", [["Τζιν", 50], ["Tonic 200ml", 1]]),
    ...M("Extra τυρί", [["Τυρί cheddar (φέτες)", 1]]),
    ...M("Extra bacon", [["Bacon", 30]]),
    ...M("Extra μοτσαρέλα", [["Μοτσαρέλα", 40]]),
    ...M("Ζαμπόν", [["Ζαμπόν", 40]]),
    ...M("Μανιτάρια", [["Μανιτάρια", 40]]),
    ...M("Πιπεριές", [["Πιπεριές", 30]]),
  ]);

  await db.insert(schema.settings).values({
    key: "venue",
    value: { venueName: "Nido Village", vatNumber: "", taxOffice: "", address: "", phone: "", courses: 1 },
  });
  // Demo χρήστης για το online dashboard συνεταίρων (/partners).
  await db.insert(schema.partnerUsers).values({ name: "Συνεταίρος (demo)", email: "partner@nido.demo", passwordHash: hashPin("nido-demo-2026") });
  return true;
}
