/**
 * Δείγμα δεδομένων για το Nido Village. Τρέχει μόνο αν η βάση είναι άδεια.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./index";
import * as schema from "./schema";
import { hashPin } from "@/server/pin";

export async function seedDemo(db: Db): Promise<boolean> {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(schema.employees);
  if ((existing[0]?.n ?? 0) > 0) return false;

  await db.insert(schema.employees).values([
    { name: "Αλέξης", role: "admin", pinHash: hashPin("1234") },
    { name: "Ελένη", role: "manager", pinHash: hashPin("4444") },
    { name: "Νίκος", role: "cashier", pinHash: hashPin("2222") },
    { name: "Μαρία", role: "waiter", pinHash: hashPin("1111") },
    { name: "Γιώργος", role: "kitchen", pinHash: hashPin("3333") },
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

  const [kitchen, bar, cashier] = await db
    .insert(schema.printStations)
    .values([
      { name: "Κουζίνα", kind: "kitchen", driver: "console", sort: 1 },
      { name: "Μπαρ", kind: "bar", driver: "console", sort: 2 },
      { name: "Ταμείο", kind: "receipt", driver: "console", sort: 3, drawerKick: true },
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
    mapAssetId = null; // χωρίς εικόνα (π.χ. σε cloud build χωρίς το αρχείο)
  }

  // Διάταξη Nido Village: «Κέντρο» (κτίριο, πισίνα, πέργκολες) και «Παιδική» (τραπέζια στον παιδότοπο).
  const [kentro, paidiki] = await db
    .insert(schema.areas)
    .values([
      { name: "Κέντρο", sort: 1, mapAssetId },
      { name: "Παιδική", sort: 2, mapAssetId },
    ])
    .returning();
  // Θέσεις σε χιλιοστά της εικόνας (x/918, y/1713), προσεγγιστικά πάνω στις ομπρέλες της φωτογραφίας.
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

  const cats = await db
    .insert(schema.categories)
    .values([
      { name: "Ορεκτικά", sort: 1, color: "#0f766e", printStationId: kitchen.id },
      { name: "Σαλάτες", sort: 2, color: "#15803d", printStationId: kitchen.id },
      { name: "Κυρίως", sort: 3, color: "#b45309", printStationId: kitchen.id },
      { name: "Θαλασσινά", sort: 4, color: "#0369a1", printStationId: kitchen.id },
      { name: "Επιδόρπια", sort: 5, color: "#be185d", printStationId: kitchen.id },
      { name: "Καφέδες", sort: 6, color: "#7c2d12", printStationId: bar.id },
      { name: "Αναψυκτικά & Νερά", sort: 7, color: "#1d4ed8", printStationId: bar.id },
      { name: "Μπύρες & Ποτά", sort: 8, color: "#6d28d9", printStationId: bar.id },
      { name: "Κρασιά", sort: 9, color: "#9f1239", printStationId: bar.id },
    ])
    .returning();
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;

  const P = (categoryId: number, name: string, price: number, vatRateId: number, sort = 0) => ({
    categoryId,
    name,
    priceCents: price,
    vatRateId,
    sort,
  });
  const products = await db
    .insert(schema.products)
    .values([
      P(cat("Ορεκτικά"), "Τζατζίκι", 450, vat13.id, 1),
      P(cat("Ορεκτικά"), "Σαγανάκι", 650, vat13.id, 2),
      P(cat("Ορεκτικά"), "Κολοκυθοκεφτέδες", 700, vat13.id, 3),
      P(cat("Ορεκτικά"), "Φέτα ψητή", 650, vat13.id, 4),
      P(cat("Ορεκτικά"), "Πατάτες τηγανητές", 400, vat13.id, 5),
      P(cat("Σαλάτες"), "Χωριάτικη", 850, vat13.id, 1),
      P(cat("Σαλάτες"), "Ντάκος", 750, vat13.id, 2),
      P(cat("Σαλάτες"), "Σαλάτα Καίσαρα", 950, vat13.id, 3),
      P(cat("Κυρίως"), "Μπριζόλα χοιρινή", 1200, vat13.id, 1),
      P(cat("Κυρίως"), "Κοτόπουλο σούβλας", 1050, vat13.id, 2),
      P(cat("Κυρίως"), "Μπιφτέκια", 1100, vat13.id, 3),
      P(cat("Κυρίως"), "Παϊδάκια", 1600, vat13.id, 4),
      P(cat("Κυρίως"), "Σουβλάκι χοιρινό (μερίδα)", 1000, vat13.id, 5),
      P(cat("Κυρίως"), "Μουσακάς", 1050, vat13.id, 6),
      P(cat("Θαλασσινά"), "Καλαμάρι τηγανητό", 1300, vat13.id, 1),
      P(cat("Θαλασσινά"), "Γαρίδες σαγανάκι", 1500, vat13.id, 2),
      P(cat("Θαλασσινά"), "Τσιπούρα ψητή", 1800, vat13.id, 3),
      P(cat("Επιδόρπια"), "Γιαούρτι με μέλι", 550, vat13.id, 1),
      P(cat("Επιδόρπια"), "Παγωτό (2 μπάλες)", 500, vat13.id, 2),
      P(cat("Επιδόρπια"), "Πορτοκαλόπιτα", 600, vat13.id, 3),
      P(cat("Καφέδες"), "Espresso", 250, vat13.id, 1),
      P(cat("Καφέδες"), "Freddo Espresso", 320, vat13.id, 2),
      P(cat("Καφέδες"), "Freddo Cappuccino", 350, vat13.id, 3),
      P(cat("Καφέδες"), "Ελληνικός", 250, vat13.id, 4),
      P(cat("Καφέδες"), "Φραπέ", 300, vat13.id, 5),
      P(cat("Αναψυκτικά & Νερά"), "Νερό 1L", 100, vat13.id, 1),
      P(cat("Αναψυκτικά & Νερά"), "Νερό 500ml", 50, vat13.id, 2),
      P(cat("Αναψυκτικά & Νερά"), "Coca-Cola 330ml", 300, vat24.id, 3),
      P(cat("Αναψυκτικά & Νερά"), "Sprite 330ml", 300, vat24.id, 4),
      P(cat("Αναψυκτικά & Νερά"), "Πορτοκαλάδα 330ml", 300, vat24.id, 5),
      P(cat("Μπύρες & Ποτά"), "Μπύρα Fix 500ml", 500, vat24.id, 1),
      P(cat("Μπύρες & Ποτά"), "Μπύρα Alfa 330ml", 400, vat24.id, 2),
      P(cat("Μπύρες & Ποτά"), "Ούζο 200ml", 800, vat24.id, 3),
      P(cat("Μπύρες & Ποτά"), "Τσίπουρο 200ml", 800, vat24.id, 4),
      P(cat("Κρασιά"), "Κρασί χύμα λευκό 500ml", 700, vat24.id, 1),
      P(cat("Κρασιά"), "Κρασί χύμα κόκκινο 500ml", 700, vat24.id, 2),
      P(cat("Κρασιά"), "Ρετσίνα 500ml", 600, vat24.id, 3),
    ])
    .returning();
  const prod = (name: string) => products.find((p) => p.name === name)!.id;

  const [gCook, gSugar, gExtras, gMilk] = await db
    .insert(schema.modifierGroups)
    .values([
      { name: "Ψήσιμο", minSelect: 1, maxSelect: 1 },
      { name: "Ζάχαρη", minSelect: 0, maxSelect: 1 },
      { name: "Extras", minSelect: 0, maxSelect: 3 },
      { name: "Γάλα", minSelect: 0, maxSelect: 1 },
    ])
    .returning();
  const mods = await db
    .insert(schema.modifiers)
    .values([
      { groupId: gCook.id, name: "Σενιάν", sort: 1 },
      { groupId: gCook.id, name: "Μέτριο", sort: 2 },
      { groupId: gCook.id, name: "Καλοψημένο", sort: 3 },
      { groupId: gSugar.id, name: "Σκέτος", sort: 1 },
      { groupId: gSugar.id, name: "Μέτριος", sort: 2 },
      { groupId: gSugar.id, name: "Γλυκός", sort: 3 },
      { groupId: gExtras.id, name: "Extra φέτα", priceDeltaCents: 150, sort: 1 },
      { groupId: gExtras.id, name: "Extra πατάτες", priceDeltaCents: 300, sort: 2 },
      { groupId: gExtras.id, name: "Χωρίς κρεμμύδι", sort: 3 },
      { groupId: gMilk.id, name: "Κανονικό", sort: 1 },
      { groupId: gMilk.id, name: "Χωρίς λακτόζη", priceDeltaCents: 30, sort: 2 },
      { groupId: gMilk.id, name: "Αμυγδάλου", priceDeltaCents: 50, sort: 3 },
    ])
    .returning();
  const mod = (name: string) => mods.find((m) => m.name === name)!.id;
  await db.insert(schema.productModifierGroups).values([
    { productId: prod("Μπριζόλα χοιρινή"), groupId: gCook.id, sort: 0 },
    { productId: prod("Μπριζόλα χοιρινή"), groupId: gExtras.id, sort: 1 },
    { productId: prod("Μπιφτέκια"), groupId: gCook.id, sort: 0 },
    { productId: prod("Παϊδάκια"), groupId: gCook.id, sort: 0 },
    { productId: prod("Χωριάτικη"), groupId: gExtras.id, sort: 0 },
    { productId: prod("Espresso"), groupId: gSugar.id, sort: 0 },
    { productId: prod("Freddo Espresso"), groupId: gSugar.id, sort: 0 },
    { productId: prod("Freddo Cappuccino"), groupId: gSugar.id, sort: 0 },
    { productId: prod("Freddo Cappuccino"), groupId: gMilk.id, sort: 1 },
    { productId: prod("Ελληνικός"), groupId: gSugar.id, sort: 0 },
    { productId: prod("Φραπέ"), groupId: gSugar.id, sort: 0 },
    { productId: prod("Φραπέ"), groupId: gMilk.id, sort: 1 },
  ]);

  const [supMeat, supFish, supDrinks, supVeg] = await db
    .insert(schema.suppliers)
    .values([
      { name: "Κρεοπωλείο Παππάς", phone: "2100000001" },
      { name: "Ιχθυοπωλείο Νίκος", phone: "2100000002" },
      { name: "Μάνος Ποτά ΑΕ", phone: "2100000003" },
      { name: "Λαχαναγορά Ρέντη", phone: "2100000004" },
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
  const ings = await db
    .insert(schema.ingredients)
    .values([
      I("Χοιρινή μπριζόλα", "g", 12000, 3000, 0.0095, supMeat.id),
      I("Κοτόπουλο", "g", 10000, 3000, 0.0065, supMeat.id),
      I("Κιμάς μοσχαρίσιος", "g", 8000, 2000, 0.011, supMeat.id),
      I("Παϊδάκια αρνίσια", "g", 6000, 2000, 0.014, supMeat.id),
      I("Χοιρινό σουβλάκι", "g", 6000, 2000, 0.0085, supMeat.id),
      I("Καλαμάρι", "g", 5000, 1500, 0.013, supFish.id),
      I("Γαρίδες", "g", 4000, 1000, 0.022, supFish.id),
      I("Τσιπούρα", "g", 6000, 2000, 0.014, supFish.id),
      I("Φέτα", "g", 5000, 1000, 0.009, supVeg.id),
      I("Ντομάτα", "g", 15000, 3000, 0.0018, supVeg.id),
      I("Αγγούρι", "g", 6000, 1000, 0.0012, supVeg.id),
      I("Κρεμμύδι", "g", 5000, 1000, 0.001, supVeg.id),
      I("Ελιές", "g", 3000, 500, 0.006, supVeg.id),
      I("Ελαιόλαδο", "ml", 10000, 2000, 0.008, supVeg.id),
      I("Πατάτες", "g", 30000, 5000, 0.0011, supVeg.id),
      I("Γιαούρτι", "g", 8000, 2000, 0.004, supVeg.id),
      I("Μέλι", "g", 2000, 500, 0.012, supVeg.id),
      I("Καφές espresso", "g", 3000, 500, 0.028, supDrinks.id),
      I("Γάλα", "ml", 10000, 2000, 0.0013, supDrinks.id),
      I("Νερό 1L", "pcs", 120, 24, 0.35, supDrinks.id),
      I("Νερό 500ml", "pcs", 120, 24, 0.2, supDrinks.id),
      I("Coca-Cola 330ml", "pcs", 96, 24, 0.85, supDrinks.id),
      I("Sprite 330ml", "pcs", 48, 12, 0.85, supDrinks.id),
      I("Πορτοκαλάδα 330ml", "pcs", 48, 12, 0.85, supDrinks.id),
      I("Μπύρα Fix 500ml", "pcs", 96, 24, 1.4, supDrinks.id),
      I("Μπύρα Alfa 330ml", "pcs", 72, 24, 1.0, supDrinks.id),
      I("Ούζο", "ml", 6000, 1000, 0.012, supDrinks.id),
      I("Τσίπουρο", "ml", 6000, 1000, 0.014, supDrinks.id),
      I("Κρασί λευκό χύμα", "ml", 20000, 5000, 0.003, supDrinks.id),
      I("Κρασί κόκκινο χύμα", "ml", 20000, 5000, 0.003, supDrinks.id),
      I("Ρετσίνα χύμα", "ml", 10000, 2000, 0.0028, supDrinks.id),
    ])
    .returning();
  const ing = (name: string) => ings.find((i) => i.name === name)!.id;
  await db.insert(schema.stockMovements).values(
    ings.map((i) => ({ ingredientId: i.id, kind: "count" as const, qtyDelta: i.stockQty, note: "Αρχικό απόθεμα (seed)" })),
  );

  const R = (productName: string, lines: [string, number][]) =>
    lines.map(([n, q]) => ({ productId: prod(productName), ingredientId: ing(n), qty: q.toFixed(3) }));
  await db.insert(schema.recipeLines).values([
    ...R("Τζατζίκι", [["Γιαούρτι", 150], ["Αγγούρι", 50], ["Ελαιόλαδο", 10]]),
    ...R("Φέτα ψητή", [["Φέτα", 150], ["Ντομάτα", 50], ["Ελαιόλαδο", 10]]),
    ...R("Πατάτες τηγανητές", [["Πατάτες", 250]]),
    ...R("Χωριάτικη", [["Ντομάτα", 150], ["Αγγούρι", 100], ["Κρεμμύδι", 30], ["Φέτα", 80], ["Ελιές", 30], ["Ελαιόλαδο", 20]]),
    ...R("Ντάκος", [["Ντομάτα", 120], ["Φέτα", 60], ["Ελιές", 20], ["Ελαιόλαδο", 15]]),
    ...R("Μπριζόλα χοιρινή", [["Χοιρινή μπριζόλα", 350], ["Πατάτες", 150]]),
    ...R("Κοτόπουλο σούβλας", [["Κοτόπουλο", 300], ["Πατάτες", 150]]),
    ...R("Μπιφτέκια", [["Κιμάς μοσχαρίσιος", 250], ["Πατάτες", 150]]),
    ...R("Παϊδάκια", [["Παϊδάκια αρνίσια", 400], ["Πατάτες", 150]]),
    ...R("Σουβλάκι χοιρινό (μερίδα)", [["Χοιρινό σουβλάκι", 250], ["Πατάτες", 150]]),
    ...R("Καλαμάρι τηγανητό", [["Καλαμάρι", 250]]),
    ...R("Γαρίδες σαγανάκι", [["Γαρίδες", 200], ["Ντομάτα", 100], ["Φέτα", 40]]),
    ...R("Τσιπούρα ψητή", [["Τσιπούρα", 400], ["Ελαιόλαδο", 15]]),
    ...R("Γιαούρτι με μέλι", [["Γιαούρτι", 200], ["Μέλι", 30]]),
    ...R("Espresso", [["Καφές espresso", 8]]),
    ...R("Freddo Espresso", [["Καφές espresso", 16]]),
    ...R("Freddo Cappuccino", [["Καφές espresso", 16], ["Γάλα", 100]]),
    ...R("Ελληνικός", [["Καφές espresso", 8]]),
    ...R("Φραπέ", [["Καφές espresso", 8], ["Γάλα", 50]]),
    ...R("Νερό 1L", [["Νερό 1L", 1]]),
    ...R("Νερό 500ml", [["Νερό 500ml", 1]]),
    ...R("Coca-Cola 330ml", [["Coca-Cola 330ml", 1]]),
    ...R("Sprite 330ml", [["Sprite 330ml", 1]]),
    ...R("Πορτοκαλάδα 330ml", [["Πορτοκαλάδα 330ml", 1]]),
    ...R("Μπύρα Fix 500ml", [["Μπύρα Fix 500ml", 1]]),
    ...R("Μπύρα Alfa 330ml", [["Μπύρα Alfa 330ml", 1]]),
    ...R("Ούζο 200ml", [["Ούζο", 200]]),
    ...R("Τσίπουρο 200ml", [["Τσίπουρο", 200]]),
    ...R("Κρασί χύμα λευκό 500ml", [["Κρασί λευκό χύμα", 500]]),
    ...R("Κρασί χύμα κόκκινο 500ml", [["Κρασί κόκκινο χύμα", 500]]),
    ...R("Ρετσίνα 500ml", [["Ρετσίνα χύμα", 500]]),
    { modifierId: mod("Extra φέτα"), ingredientId: ing("Φέτα"), qty: "50.000" },
    { modifierId: mod("Extra πατάτες"), ingredientId: ing("Πατάτες"), qty: "200.000" },
  ]);

  await db.insert(schema.settings).values({
    key: "venue",
    value: { venueName: "Nido Village", vatNumber: "", taxOffice: "", address: "", phone: "", courses: 3 },
  });
  void cashier;
  return true;
}
