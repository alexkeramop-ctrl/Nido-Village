// E2E: ταμείο ↔ χώρος, QR τραπεζιού → ταμείο που έχει αναλάβει τον χώρο, ανάγνωση τιμολογίου (ψεύτικη απάντηση του
// /api/invoices/read μέσα στον browser, αληθινή καταχώρηση), μενού κουζίνας με «Με πατάτες».
// Χρήση σε ΚΑΘΑΡΗ βάση demo (όπως το e2e-smoke), με ANTHROPIC_API_KEY=οτιδήποτε ώστε να ενεργοποιηθεί το κουμπί
// (το πραγματικό API δεν καλείται):
//   PGLITE_DIR=$(mktemp -d) NEXT_DIST_DIR=.next-c ANTHROPIC_API_KEY=dummy npm start -- -p 3103
//   BASE=http://localhost:3103 OUT=screenshots node scripts/e2e-qr-invoice.mjs
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3103";
const OUT = process.env.OUT || "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const TABLET = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 };
const errors = [];
let n = 0;
const fail = (m) => {
  errors.push(m);
  console.log("✗", m);
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true });
const watch = (p, label) => {
  p.on("pageerror", (e) => fail(`${label}: pageerror ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource.*(404|401)/.test(m.text()) && fail(`${label}: console ${m.text()}`));
  p.on("response", (r) => r.status() >= 500 && fail(`${label}: HTTP ${r.status()} ${r.url()}`));
};
async function login(p, pin) {
  await p.goto(`${BASE}/login`);
  await p.waitForLoadState("networkidle");
  for (const d of pin) await p.getByRole("button", { name: d, exact: true }).click();
  await p.getByRole("button", { name: "Είσοδος" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}
async function order(q, tableId, name) {
  await q.goto(`${BASE}/order?t=${tableId}`);
  await q.waitForLoadState("networkidle");
  await q.getByRole("button", { name: /Coca-Cola 330ml/ }).first().click();
  await q.getByRole("button", { name: /Καλάθι/ }).click();
  const nameBox = q.getByPlaceholder("π.χ. Κώστας");
  if (!(await nameBox.isVisible().catch(() => false))) await q.getByRole("button", { name: "Αποστολή παραγγελίας" }).click();
  await nameBox.fill(name);
  await q.getByRole("button", { name: "Αποστολή παραγγελίας" }).click();
  await q.waitForURL(/\/order\/[A-Za-z0-9_-]{10,}$/, { timeout: 30000 });
}

await (async () => {
  const browser = await chromium.launch();
  const admin = await (await browser.newContext(TABLET)).newPage();
  const cashier = await (await browser.newContext(TABLET)).newPage();
  const customer = await (await browser.newContext(PHONE)).newPage();
  watch(admin, "admin");
  watch(cashier, "cashier");
  watch(customer, "customer");
  try {
    // 1. Ρυθμίσεις: χώρος ανά ταμείο.
    await login(admin, "1234");
    await admin.goto(`${BASE}/admin/settings`);
    await admin.getByRole("heading", { name: "Ταμεία" }).waitFor();
    const regText = await admin.locator("section", { has: admin.getByRole("heading", { name: "Ταμεία" }) }).innerText();
    if (!/Ταμείο 1\s+Κέντρο/.test(regText) || !/Ταμείο 2\s+Παιδική/.test(regText)) fail(`settings: λάθος χώροι ταμείων: ${regText.slice(0, 200)}`);
    await admin.getByRole("button", { name: "Επεξεργασία Ταμείο 2" }).click();
    await admin.locator("select[name=areaId]").waitFor();
    await shot(admin, "settings-register-area");
    await admin.keyboard.press("Escape");

    // 2. QR τραπεζιών.
    await admin.goto(`${BASE}/admin/qr/tables`);
    await admin.waitForLoadState("networkidle");
    const ids = {};
    for (const name of ["Π3", "Κ5"]) {
      const card = admin.locator("[data-testid^=table-qr-]").filter({ has: admin.getByText(name, { exact: true }) }).first();
      ids[name] = Number((await card.getAttribute("data-testid")).replace("table-qr-", ""));
    }
    if (!(ids["Π3"] > 0 && ids["Κ5"] > 0)) fail("qr/tables: δεν βρέθηκαν τα Π3/Κ5");
    await shot(admin, "qr-tables");

    // 3. Ταμείο 2: άνοιγμα βάρδιας με QR μόνο από Παιδική (+ πακέτα).
    await login(cashier, "2222");
    await cashier.goto(`${BASE}/cashier`);
    await cashier.getByRole("button", { name: /Ταμείο 2/ }).click();
    await cashier.getByText("Η βάρδια είναι κλειστή").waitFor();
    await cashier.waitForLoadState("networkidle");
    const on = async (key) => (await cashier.locator(`[data-testid=qr-${key}]`).getAttribute("aria-checked")) === "true";
    const areaKeys = await cashier.locator("[data-testid^=qr-a]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice(3)));
    const states = {};
    for (const k of areaKeys) states[(await cashier.locator(`[data-testid=qr-${k}] .font-semibold`).innerText()).trim()] = await on(k);
    if (!(states["Παιδική"] === true && states["Κέντρο"] === false && (await on("takeaway")))) fail(`shift: λάθος προεπιλογή QR ${JSON.stringify(states)}`);
    await shot(cashier, "open-shift-qr-areas");
    await cashier.getByPlaceholder("0,00").fill("50");
    await cashier.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 2" }).click();
    const chip = cashier.locator("[data-testid=qr-areas-chip]");
    await chip.waitFor({ timeout: 20000 });
    if (!/Παιδική · Πακέτο/.test(await chip.innerText())) fail(`till: chip ${await chip.innerText()}`);

    // 4. Πελάτες: Π3 (Παιδική) και Κ5 (Κέντρο, κανένα ταμείο).
    await customer.goto(`${BASE}/order?t=${ids["Π3"]}`);
    await customer.getByTestId("qr-table").waitFor();
    if (!/Τραπέζι Π3/.test(await customer.locator("h1").innerText())) fail("order: δεν φαίνεται «Τραπέζι Π3»");
    await shot(customer, "order-table-p3");
    await order(customer, ids["Π3"], "Μαρία");
    await order(customer, ids["Κ5"], "Νίκη");

    await cashier.getByRole("button", { name: /Προς πληρωμή \(2\)/ }).click({ timeout: 25000 });
    const sheet = cashier.locator(".glass-modal").last();
    await sheet.getByText("Μαρία · Π3").waitFor();
    const sheetText = await sheet.innerText();
    if (!sheetText.includes("Παιδική")) fail("till: δεν φαίνεται ο χώρος Παιδική");
    if (!sheetText.includes("Χωρίς ταμείο")) fail("till: η παραγγελία του Κ5 δεν έχει «Χωρίς ταμείο»");
    await shot(cashier, "till-orders-qr-areas");
    await cashier.keyboard.press("Escape");

    // 5. Μέσα στη βάρδια: παίρνει και το Κέντρο.
    await chip.click();
    const m = cashier.locator(".glass-modal").last();
    await m.getByText("Παραγγελίες QR που εμφανίζονται εδώ").waitFor();
    await m.locator("[data-testid^=qr-a]").filter({ hasText: "Κέντρο" }).click();
    await shot(cashier, "till-qr-modal");
    await m.getByTestId("qr-areas-save").click();
    await cashier.waitForFunction(() => /Κέντρο · Παιδική · Πακέτο/.test(document.querySelector("[data-testid=qr-areas-chip]")?.textContent || ""), null, { timeout: 15000 });
    await cashier.getByRole("button", { name: /Προς πληρωμή \([1-9]\d*\)/ }).click();
    await cashier.locator(".glass-modal").last().getByText("Νίκη · Κ5").waitFor();
    if ((await cashier.locator(".glass-modal").last().innerText()).includes("Χωρίς ταμείο")) fail("till: έμεινε «Χωρίς ταμείο» μετά την ανάληψη του Κέντρου");
    await cashier.keyboard.press("Escape");

    // 6. Ανάγνωση τιμολογίου (η απάντηση του /api/invoices/read είναι ψεύτικη· η καταχώρηση είναι αληθινή).
    await admin.route("**/api/invoices/read", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          draft: {
            isInvoice: true,
            supplier: { id: null, name: "ΓΑΛΑΚΤΟΚΟΜΙΚΑ ΒΟΡΕΙΟΥ ΑΕ", vat: "998877665", matchedBy: null },
            docType: "Τιμολόγιο - Δελτίο Αποστολής",
            docNumber: "ΤΔΑ 4521",
            docDate: "2026-11-20",
            lines: [
              { index: 0, itemKey: "γαλα φρεσκο πληρεσ 1lt", code: "102", description: "ΓΑΛΑ ΦΡΕΣΚΟ ΠΛΗΡΕΣ 1LT", quantity: 12, unit: "ΛΙΤ", unitPriceNet: 1.1, lineNet: 13.2, vatPct: 13, ingredientId: null, factor: null, source: null },
              { index: 1, itemKey: "μεταφορικα", code: null, description: "ΜΕΤΑΦΟΡΙΚΑ", quantity: 1, unit: null, unitPriceNet: 2, lineNet: 2, vatPct: 24, ingredientId: null, factor: null, source: null },
            ],
            totalNet: 15.2,
            totalVat: 2.2,
            totalGross: 17.4,
            linesNet: 15.2,
            warnings: ["Η ημερομηνία είναι λίγο θολή: έλεγξέ τη."],
            duplicateOf: null,
          },
        }),
      }),
    );
    await admin.goto(`${BASE}/admin/inventory?tab=receive`);
    await admin.getByText("Ανάγνωση τιμολογίου").first().waitFor();
    await admin.waitForLoadState("networkidle");
    await admin.getByTestId("invoice-file").setInputFiles({ name: "inv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    const draft = admin.getByTestId("invoice-draft");
    await draft.waitFor({ timeout: 15000 });
    await draft.locator("select[aria-label='Πρώτη ύλη']").first().selectOption({ label: "Γάλα (ml)" });
    const factor = await draft.locator("input[aria-label='Μετατροπή μονάδας']").first().inputValue();
    if (factor !== "1000") fail(`invoice: ο συντελεστής ΛΙΤ→ml είναι «${factor}» αντί για 1000`);
    await shot(admin, "invoice-draft");
    await admin.getByTestId("invoice-submit").click();
    await admin.getByText("Η παραλαβή καταχωρήθηκε από το τιμολόγιο").waitFor({ timeout: 15000 });
    await admin.reload();
    await admin.waitForLoadState("networkidle");
    const prev = await admin.locator("section", { has: admin.getByRole("heading", { name: "Προηγούμενες παραλαβές" }) }).innerText();
    if (!prev.includes("ΓΑΛΑΚΤΟΚΟΜΙΚΑ ΒΟΡΕΙΟΥ ΑΕ") || !prev.includes("ΤΔΑ 4521")) fail("invoice: η παραλαβή δεν φαίνεται στις προηγούμενες");
    await shot(admin, "invoice-saved");

    // 7. Μενού κουζίνας: κουμπί στη Διαχείριση → είδη στο ταμείο με επιλογή «Με πατάτες».
    await admin.goto(`${BASE}/admin/menu`);
    await admin.waitForLoadState("networkidle");
    admin.once("dialog", (d) => d.accept());
    await admin.getByTestId("load-kitchen-menu").click();
    await admin.getByText("Προστέθηκαν 34 είδη κουζίνας").waitFor({ timeout: 20000 });
    await cashier.reload();
    await cashier.waitForLoadState("networkidle");
    await cashier.getByRole("button", { name: "Burgers", exact: true }).click();
    await cashier.getByRole("button", { name: /Classic Burger 190γρ/ }).first().click();
    const pm = cashier.locator(".glass-modal").last();
    await pm.getByText("Με πατάτες").waitFor({ timeout: 10000 });
    await shot(cashier, "till-burger-fries");
    await cashier.keyboard.press("Escape");
    await cashier.getByRole("button", { name: "Brunch", exact: true }).click();
    await shot(cashier, "till-brunch");
  } catch (e) {
    fail(`exception: ${e.message}`);
    await Promise.all([admin, cashier, customer].map((p, i) => p.screenshot({ path: `${OUT}/zz-fail-${i}.png`, fullPage: true }).catch(() => {})));
  }
  await browser.close();
  console.log(errors.length ? `FAILED ${errors.length}` : "NEW FLOWS OK");
  process.exit(errors.length ? 1 : 0);
})();
