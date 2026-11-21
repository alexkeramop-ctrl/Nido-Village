// E2E: ταμείο ↔ χώρος, QR (μόνο μενού· οι παραγγελίες QR είναι κλειστές μέχρι να υπάρξει online πληρωμή),
// ανάγνωση τιμολογίου (ψεύτικη απάντηση του /api/invoices/read μέσα στον browser, αληθινή καταχώρηση),
// μενού κουζίνας με «Με πατάτες».
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

    const tableText = await admin.locator("[data-testid^=table-qr-]").first().innerText();
    if (!tableText.includes("Σκάναρε για το μενού")) fail("qr/tables: το QR τραπεζιού δεν γράφει «Σκάναρε για το μενού»");

    // 3. Ταμείο 2: άνοιγμα βάρδιας. Οι παραγγελίες QR είναι κλειστές, άρα καμία επιλογή χώρων QR.
    await login(cashier, "2222");
    await cashier.goto(`${BASE}/cashier`);
    await cashier.getByRole("button", { name: /Ταμείο 2/ }).click();
    await cashier.getByText("Η βάρδια είναι κλειστή").waitFor();
    await cashier.waitForLoadState("networkidle");
    if (await cashier.locator("[data-testid^=qr-]").count()) fail("shift: εμφανίζεται επιλογή χώρων QR ενώ οι παραγγελίες QR είναι κλειστές");
    await shot(cashier, "open-shift");
    await cashier.getByPlaceholder("0,00").fill("50");
    await cashier.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 2" }).click();
    await cashier.getByRole("navigation", { name: "Κατηγορίες" }).waitFor({ timeout: 20000 });
    if (await cashier.locator("[data-testid=qr-areas-chip]").count()) fail("till: εμφανίζεται «QR: …» ενώ οι παραγγελίες QR είναι κλειστές");

    // 4. Πελάτης: το QR τραπεζιού ανοίγει μόνο το μενού (χωρίς καλάθι/παραγγελία).
    await customer.goto(`${BASE}/order?t=${ids["Π3"]}`);
    await customer.getByRole("heading", { name: "Μενού" }).waitFor();
    if (await customer.getByRole("button", { name: /Καλάθι/ }).count()) fail("order: εμφανίζεται καλάθι");
    if ((await customer.locator("[data-testid=menu-item]").count()) < 10) fail("order: λίγα είδη στο μενού");
    await shot(customer, "qr-menu-only");

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

    // 8. Κοστολόγηση: έτοιμα προϊόντα με τιμή ανά τεμάχιο (χωρίς συνταγή).
    await admin.goto(`${BASE}/admin/costing`);
    await admin.waitForLoadState("networkidle");
    await admin.getByTestId("resale-open").click();
    const list = admin.getByTestId("resale-list");
    await list.waitFor();
    const inputs = list.locator("input");
    const count = await inputs.count();
    if (count < 1) fail("costing: η λίστα «Έτοιμα προϊόντα» είναι άδεια");
    for (let i = 0; i < count; i++) if (!(await inputs.nth(i).inputValue())) { await inputs.nth(i).fill("0,45"); break; }
    await shot(admin, "costing-resale");
    await admin.getByTestId("resale-save").click();
    await admin.getByText(/Αποθηκεύτηκαν \d+ έτοιμα προϊόντα/).waitFor({ timeout: 15000 });
  } catch (e) {
    fail(`exception: ${e.message}`);
    await Promise.all([admin, cashier, customer].map((p, i) => p.screenshot({ path: `${OUT}/zz-fail-${i}.png`, fullPage: true }).catch(() => {})));
  }
  await browser.close();
  console.log(errors.length ? `FAILED ${errors.length}` : "NEW FLOWS OK");
  process.exit(errors.length ? 1 : 0);
})();
