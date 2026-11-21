// E2E: τα 3 λάθη χρημάτων του ταμείου (έλεγχος 17/11/2026) δεν επιστρέφουν.
//  1. Αλλαγή καλαθιού με ανοιχτή την πληρωμή → «Ολοκλήρωση» γράφει την πώληση με το νέο σύνολο (όχι σιωπηλά τίποτα).
//  2. Έκπτωση και μετά άδειασμα του καλαθιού γραμμή-γραμμή → ο επόμενος πελάτης ΧΩΡΙΣ έκπτωση· το καλάθι δείχνει το σωστό σύνολο.
//  3. Αλλαγή τιμής στο μενού ενώ το ταμείο είναι ανοιχτό, χωρίς ζωντανά μηνύματα (όπως στο Cloudflare: μόνο έλεγχος ανά 15″)
//     → το ταμείο ξαναφορτώνει το μενού, ενημερώνει το καλάθι και η πώληση περνά με τη νέα τιμή.
// Χρήση σε ΚΑΘΑΡΗ βάση demo:  BASE=http://localhost:3103 OUT=screenshots node scripts/e2e-till-money.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3103";
const OUT = process.env.OUT || "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const TABLET = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const errors = [];
let n = 0;
const fail = (m) => {
  errors.push(m);
  console.log("✗", m);
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true });
const euro = (c) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
const watch = (p, label) => {
  p.on("pageerror", (e) => fail(`${label}: pageerror ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && fail(`${label}: HTTP ${r.status()} ${r.url()}`));
};
async function login(p, pin) {
  await p.goto(`${BASE}/login`);
  await p.waitForLoadState("networkidle");
  for (const d of pin) await p.getByRole("button", { name: d, exact: true }).click();
  await p.getByRole("button", { name: "Είσοδος" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await (async () => {
  const browser = await chromium.launch();
  const tctx = await browser.newContext(TABLET);
  // Όπως στο Cloudflare Workers: το /api/events δεν κρατά σύνδεση, το ταμείο ελέγχει μόνο ανά 15″.
  await tctx.route("**/api/events*", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" }, body: `retry: 600000\ndata: ${JSON.stringify({ type: "unsupported", pollMs: 15000 })}\n\n` }),
  );
  const till = await tctx.newPage();
  const admin = await (await browser.newContext(TABLET)).newPage();
  watch(till, "till");
  watch(admin, "admin");
  const cats = () => till.getByRole("navigation", { name: "Κατηγορίες" });
  const cart = () => till.getByRole("complementary", { name: "Καλάθι" });
  const tap = async (category, product) => {
    await cats().getByRole("button", { name: category, exact: true }).click();
    await till.getByRole("region", { name: "Είδη" }).getByRole("button", { name: new RegExp(`^${esc(product)}, `) }).click();
  };
  const lastSale = () => cart().locator("[data-testid=last-sale]");
  try {
    // Υπεύθυνος στο ταμείο (μόνο υπεύθυνος/διαχειριστής κάνει έκπτωση).
    await login(till, "1234");
    await till.goto(`${BASE}/cashier`);
    await till.getByRole("button", { name: /Ταμείο 1/ }).click();
    await till.getByText("Η βάρδια είναι κλειστή").waitFor();
    await till.waitForLoadState("networkidle");
    await till.getByPlaceholder("0,00").fill("50");
    await till.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 1" }).click();
    await cats().waitFor({ timeout: 20000 });
    await till.waitForLoadState("networkidle");

    // 1. Νερό 1L → Πληρωμή → πάτημα «Νερό 500ml» στο πλέγμα → Ολοκλήρωση: πρέπει να γραφτεί η πώληση με 1,50 €.
    await tap("Αναψυκτικά", "Νερό 1L");
    await cart().getByRole("button", { name: `Πληρωμή ${euro(100)}` }).click();
    await tap("Αναψυκτικά", "Νερό 500ml");
    await cart().getByText(euro(150)).first().waitFor();
    await cart().getByRole("button", { name: "Ολοκλήρωση" }).click();
    await lastSale()
      .filter({ hasText: euro(150) })
      .waitFor({ timeout: 10000 })
      .catch(() => fail("λάθος 1: η «Ολοκλήρωση» μετά από αλλαγή καλαθιού δεν έγραψε την πώληση των 1,50 €"));
    await shot(till, "bug1-sale-after-cart-change");

    // 2. 2× Νερό 500ml → Πληρωμή → έκπτωση 0,60 → πίσω στο καλάθι → αφαίρεση γραμμής → επόμενος πελάτης χωρίς έκπτωση.
    await tap("Αναψυκτικά", "Νερό 500ml");
    await tap("Αναψυκτικά", "Νερό 500ml");
    await cart().getByRole("button", { name: `Πληρωμή ${euro(100)}` }).click();
    await cart().getByRole("button", { name: "Έκπτωση" }).click();
    const dm = till.locator(".glass-modal").last();
    await dm.getByPlaceholder("0,00").fill("0,60");
    await dm.getByPlaceholder("Γράψε αιτιολογία…").fill("Κέρασμα");
    await dm.getByRole("button", { name: "Εφαρμογή έκπτωσης" }).click();
    await cart().getByText("Έκπτωση · Κέρασμα").waitFor();
    await cart().getByRole("button", { name: /^‹/ }).click();
    if (!(await cart().getByTestId("cart-discount").count())) fail("λάθος 2: το καλάθι δεν δείχνει την έκπτωση");
    if (!(await cart().getByRole("button", { name: `Πληρωμή ${euro(40)}` }).count())) fail("λάθος 2: το κουμπί πληρωμής δεν δείχνει το σύνολο μετά την έκπτωση (0,40 €)");
    await shot(till, "bug2-discount-in-cart");
    await cart().getByRole("button", { name: "Αφαίρεση Νερό 500ml" }).click();
    await tap("Αναψυκτικά", "Coca-Cola 330ml");
    const colaPrice = 250;
    if (await cart().getByTestId("cart-discount").count()) fail("λάθος 2: η έκπτωση πέρασε στον επόμενο πελάτη");
    await cart().getByRole("button", { name: `Πληρωμή ${euro(colaPrice)}` }).click();
    if ((await cart().innerText()).includes("Κέρασμα")) fail("λάθος 2: η πληρωμή του επόμενου πελάτη έχει έκπτωση");
    await cart().getByRole("button", { name: "Ολοκλήρωση" }).click();
    await lastSale()
      .filter({ hasText: euro(colaPrice) })
      .waitFor({ timeout: 10000 })
      .catch(() => fail(`λάθος 2: η πώληση του επόμενου πελάτη δεν είναι ${euro(colaPrice)}`));

    // 3. Νερό 1L στο καλάθι, ο διαχειριστής αλλάζει την τιμή σε 1,50 €, το ταμείο (μόνο έλεγχος) πρέπει να προσαρμοστεί.
    await tap("Αναψυκτικά", "Νερό 1L");
    await cart().getByRole("button", { name: `Πληρωμή ${euro(100)}` }).waitFor();
    await login(admin, "1234");
    await admin.goto(`${BASE}/admin/menu`);
    await admin.waitForLoadState("networkidle");
    await admin.getByRole("button", { name: "Επεξεργασία Νερό 1L" }).click();
    const price = admin.locator("input[name=price]");
    await price.fill("1,50");
    await price.press("Enter");
    await admin.waitForTimeout(1500);
    await cart()
      .getByTestId("cart-repriced")
      .waitFor({ timeout: 40000 })
      .catch(() => fail("λάθος 3: το ταμείο δεν ενημέρωσε το καλάθι μετά την αλλαγή τιμής"));
    if (!(await cart().getByRole("button", { name: `Πληρωμή ${euro(150)}` }).count())) fail("λάθος 3: το κουμπί πληρωμής δεν δείχνει τη νέα τιμή 1,50 €");
    await shot(till, "bug3-repriced");
    await cart().getByRole("button", { name: `Πληρωμή ${euro(150)}` }).click();
    await cart().getByRole("button", { name: "Ολοκλήρωση" }).click();
    await lastSale()
      .filter({ hasText: euro(150) })
      .waitFor({ timeout: 10000 })
      .catch(() => fail("λάθος 3: η πώληση με τη νέα τιμή δεν ολοκληρώθηκε"));
    // Το ίδιο το πλέγμα δείχνει πλέον τη νέα τιμή.
    await cats().getByRole("button", { name: "Αναψυκτικά", exact: true }).click();
    const tile = await till.getByRole("region", { name: "Είδη" }).getByRole("button", { name: /^Νερό 1L, / }).innerText();
    if (!tile.includes("1,50")) fail(`λάθος 3: το είδος στο ταμείο δείχνει ακόμη την παλιά τιμή (${tile.replace(/\s+/g, " ")})`);
  } catch (e) {
    fail(`exception: ${e.message}`);
    await till.screenshot({ path: `${OUT}/zz-fail-till.png`, fullPage: true }).catch(() => {});
    await admin.screenshot({ path: `${OUT}/zz-fail-admin.png`, fullPage: true }).catch(() => {});
  }
  await browser.close();
  console.log(errors.length ? `FAILED ${errors.length}` : "TILL MONEY OK");
  process.exit(errors.length ? 1 : 0);
})();
