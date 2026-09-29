// End-to-end έλεγχος με Playwright: login, PDA παραγγελία, KDS, ταμείο, admin, partners.
// Χρήση: BASE=http://localhost:3000 PARTNER_EMAIL=… PARTNER_PASSWORD=… node scripts/e2e-smoke.mjs
// (χρειάζεται τρέχοντα server με δεδομένα επίδειξης και έναν χρήστη συνεταίρου)
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const OUT = process.env.OUT ?? "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

async function loginPin(page, pin) {
  await page.goto(`${BASE}/login`);
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Είσοδος" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}
async function checkNoError(page, label) {
  const body = await page.locator("body").innerText().catch(() => "");
  for (const bad of ["Application error", "Unhandled Runtime Error", "This page could not be found", "Internal Server Error"]) {
    if (body.includes(bad)) errors.push(`${label}: ${bad}`);
  }
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  // Waiter on phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "el-GR" });
  const p = await phone.newPage();
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await loginPin(p, "1111");
  await p.goto(`${BASE}/pda`);
  await checkNoError(p, "/pda");
  await shot(p, "01-pda-floor");
  await p.getByText("Κ2", { exact: true }).first().click();
  await p.waitForURL(/\/pda\/s\/\d+/, { timeout: 20000 });
  await checkNoError(p, "/pda/s");
  await shot(p, "02-pda-order-empty");
  // add Coca-Cola (no modifiers) and a steak with modifier
  await p.getByRole("button", { name: /Αναψυκτικά/ }).click().catch(() => {});
  await p.getByRole("button", { name: /Coca-Cola 330ml/ }).first().click();
  await p.getByRole("button", { name: /Κυρίως/ }).click().catch(() => {});
  await p.getByRole("button", { name: /Μπριζόλα χοιρινή/ }).first().click();
  await p.getByRole("button", { name: "Μέτριο", exact: true }).click().catch(() => {});
  await p.getByRole("button", { name: /Προσθήκη/ }).click().catch(() => {});
  await shot(p, "03-pda-cart");
  const cartBtn = p.getByRole("button", { name: /Καλάθι/ });
  if (await cartBtn.count()) await cartBtn.first().click();
  await p.getByRole("button", { name: /Αποστολή/ }).first().click();
  await p.waitForTimeout(1500);
  await checkNoError(p, "/pda/s after send");
  await shot(p, "04-pda-sent");
  const sentText = await p.locator("body").innerText();
  if (!sentText.includes("Μπριζόλα χοιρινή")) errors.push("PDA: sent item not visible");
  await phone.close();

  // Kitchen on tablet
  const tab = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "el-GR" });
  const k = await tab.newPage();
  k.on("pageerror", (e) => errors.push("kds pageerror: " + e.message));
  await loginPin(k, "3333");
  await k.goto(`${BASE}/kds`);
  await checkNoError(k, "/kds");
  await shot(k, "05-kds");
  const kdsText = await k.locator("body").innerText();
  if (!kdsText.includes("Κ2")) errors.push("KDS: ticket for Κ2 not visible");
  const bump = k.getByRole("button", { name: /ΕΤΟΙΜΟ|Έτοιμο/ }).first();
  if (await bump.count()) await bump.click();
  await k.waitForTimeout(800);
  await shot(k, "06-kds-after-bump");

  // Cashier
  await loginPin(k, "2222");
  await k.goto(`${BASE}/cashier`);
  await checkNoError(k, "/cashier");
  await shot(k, "07-cashier");
  await k.getByText("Κ2", { exact: true }).first().click();
  await k.waitForURL(/\/cashier\/s\/\d+/, { timeout: 20000 });
  await checkNoError(k, "/cashier/s");
  await shot(k, "08-cashier-bill");
  const payBtn = k.getByRole("button", { name: /Πληρωμή/ }).first();
  if (await payBtn.count()) await payBtn.click();
  await k.waitForTimeout(1500);
  await checkNoError(k, "/cashier/s after pay");
  await shot(k, "09-cashier-paid");

  // Admin
  await loginPin(k, "1234");
  for (const r of ["/admin", "/admin/menu", "/admin/modifiers", "/admin/tables", "/admin/staff", "/admin/printers", "/admin/inventory", "/admin/recipes", "/admin/reports", "/admin/partners", "/admin/settings", "/admin/audit"]) {
    await k.goto(`${BASE}${r}`);
    await k.waitForLoadState("networkidle").catch(() => {});
    await checkNoError(k, r);
    await shot(k, "10-admin" + r.replace(/\//g, "-"));
  }
  await tab.close();

  // QR take-away: πελάτης σε κινητό, κουζίνα, οθόνη παραλαβών, ταμείο, admin QR
  const qc = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "el-GR" });
  const q = await qc.newPage();
  q.on("pageerror", (e) => errors.push("order pageerror: " + e.message));
  q.on("console", (m) => { if (m.type() === "error") errors.push("order console: " + m.text()); });
  await q.goto(`${BASE}/order`, { waitUntil: "networkidle" });
  await checkNoError(q, "/order");
  await q.getByRole("button", { name: /Κυρίως/ }).first().click();
  await q.waitForTimeout(400);
  await q.getByRole("button", { name: /Μπριζόλα χοιρινή/ }).first().click();
  await q.getByRole("button", { name: "Μέτριο", exact: true }).waitFor({ timeout: 10000 });
  await q.getByRole("button", { name: "Μέτριο", exact: true }).click();
  await q.getByRole("button", { name: /^Προσθήκη/ }).click();
  await q.getByRole("button", { name: /Coca-Cola 330ml/ }).first().click();
  await q.waitForTimeout(300);
  await q.getByRole("button", { name: /Καλάθι/ }).click();
  await q.getByRole("heading", { name: "Το καλάθι σου" }).waitFor();
  await shot(q, "12-order-cart");
  await q.getByRole("button", { name: "Αποστολή παραγγελίας" }).click();
  await q.waitForTimeout(300);
  await q.getByPlaceholder("π.χ. Κώστας").fill("Κώστας");
  await q.getByPlaceholder("69xxxxxxxx").fill("6912345678");
  await q.getByRole("button", { name: "Αποστολή παραγγελίας" }).click();
  await q.waitForURL(/\/order\/[A-Za-z0-9_-]{10,}$/, { timeout: 30000 });
  await q.waitForLoadState("networkidle");
  await checkNoError(q, "/order/[token]");
  const st = await q.locator("body").innerText();
  if (!/#\d{3}/.test(st) || !st.includes("Ελήφθη")) errors.push("order status page missing code or status");
  const code = (st.match(/#(\d{3})/) || [])[1];
  await shot(q, "13-order-status");

  const kq = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "el-GR" })).newPage();
  await loginPin(kq, "3333");
  await kq.goto(`${BASE}/kds`, { waitUntil: "networkidle" });
  const ticket = kq.locator("article", { hasText: `#${code}` });
  if (!(await ticket.count())) errors.push("KDS: QR ticket not visible");
  else await ticket.first().getByRole("button", { name: "ΕΤΟΙΜΟ" }).click();
  await q.getByText("Η παραγγελία σου είναι έτοιμη!").waitFor({ timeout: 10000 }).catch(() => errors.push("order status: ready panel did not appear live"));
  await shot(q, "14-order-ready");

  await kq.goto(`${BASE}/pickup`, { waitUntil: "networkidle" });
  await checkNoError(kq, "/pickup");
  const readyCol = await kq.locator('section[data-column="ready"]').innerText().catch(() => "");
  if (!readyCol.includes(code)) errors.push("pickup board: code not in ready column");
  await shot(kq, "15-pickup-board");

  await loginPin(kq, "2222");
  await kq.goto(`${BASE}/cashier`, { waitUntil: "networkidle" });
  const pick = kq.getByRole("button", { name: new RegExp(`Παραδόθηκε η παραγγελία #${code}`) });
  if (!(await pick.count())) errors.push("cashier: pickup button missing");
  else await pick.click();
  await q.getByText("Ευχαριστούμε!").waitFor({ timeout: 10000 }).catch(() => errors.push("order status: thank-you did not appear after pickup"));

  await loginPin(kq, "1234");
  await kq.goto(`${BASE}/admin/qr`, { waitUntil: "networkidle" });
  await checkNoError(kq, "/admin/qr");
  const src = await kq.getByTestId("qr-image").getAttribute("src").catch(() => null);
  if (!src || !src.startsWith("data:image/png")) errors.push("admin/qr: QR image missing");
  await shot(kq, "16-admin-qr");
  await kq.goto(`${BASE}/admin/floor`, { waitUntil: "networkidle" });
  await checkNoError(kq, "/admin/floor");
  await shot(kq, "17-admin-floor");
  await qc.close();
  await kq.context().close();

  // Partners
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "el-GR" });
  const pp = await pc.newPage();
  pp.on("pageerror", (e) => errors.push("partners pageerror: " + e.message));
  await pp.goto(`${BASE}/partners`);
  await pp.waitForURL(/\/partners\/login/);
  await pp.fill('input[type="email"]', process.env.PARTNER_EMAIL ?? "partner@nido.test");
  await pp.fill('input[type="password"]', process.env.PARTNER_PASSWORD ?? "partner123");
  await pp.getByRole("button", { name: "Είσοδος" }).click();
  await pp.waitForURL(/\/partners$/, { timeout: 20000 });
  await checkNoError(pp, "/partners");
  await shot(pp, "11-partners-phone");
  const ptxt = await pp.locator("body").innerText();
  if (!ptxt.includes("Πληρωμές σήμερα")) errors.push("partners: dashboard missing");
  await pc.close();
} finally {
  await browser.close();
}
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("SMOKE OK");
