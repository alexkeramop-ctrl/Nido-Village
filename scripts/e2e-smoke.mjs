// End-to-end έλεγχος με Playwright πάνω στα δεδομένα επίδειξης (src/db/seed.ts):
//  1. PDA: ο σερβιτόρος ανοίγει το Κ2 και στέλνει παραγγελία
//  2. Διαχείριση: ημερολόγια (/admin/trips, /admin/parties, /admin/ceremonies, /admin/events) — νέα εκδρομή, νέο πάρτι με σύμπτωση ώρας
//  3. Προσωπικό: ημερολόγιο /pda/calendar με φίλτρα (χωρίς τηλέφωνο/τιμές για σερβιτόρο), παλιό /pda/trips, όχι πρόσβαση στη Διαχείριση
//  4. Κουζίνα: «ΕΤΟΙΜΟ» για το Κ2
//  5. Ταμείο self-service: επιλογή ταμείου, άνοιγμα βάρδιας, γρήγορη πώληση (μετρητά + ρέστα, κάρτα), βομβητής σε χρήση,
//     πληρωμή του Κ2 από τα «Προς πληρωμή»
//  6. Βομβητής: ΕΤΟΙΜΟ στην κουζίνα, οθόνη παραλαβών, «Παραδόθηκε» από κουζίνα και ταμείο
//  7. QR take-away: πελάτης στο κινητό → πληρωμή στο ταμείο με βομβητή → κουζίνα → παραλαβή
//  8. Κλείσιμο ταμείου με έλλειμμα και έλεγχος των ποσών, αναφορά /admin/registers
//  9. Όλες οι σελίδες της Διαχείρισης, QR, PIN προσωπικού, dashboard συνεταίρων
// Σε κάθε σελίδα: pageerror, console error, HTTP ≥ 500 και μηνύματα σφάλματος του Next μετρούν ως αποτυχία.
//
// Χρήση (σε ΚΑΘΑΡΗ βάση demo, χωρίς NIDO_ADMIN_PIN, ώστε να ισχύουν τα PIN 1234/4444/2222/1111):
//   export NEXT_DIST_DIR=.next-c PGLITE_DIR=$(mktemp -d) PORT=3103 NIDO_SECRET=κάτι
//   npm run build && npm start
//   BASE=http://localhost:3103 PARTNER_EMAIL=partner@nido.demo PARTNER_PASSWORD=nido-demo-2026 node scripts/e2e-smoke.mjs
// Στιγμιότυπα στο OUT (προεπιλογή screenshots/). Τυπώνει «SMOKE OK» και τελειώνει με 0 μόνο αν όλα πέρασαν.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const OUT = process.env.OUT ?? "screenshots";
const PARTNER_EMAIL = process.env.PARTNER_EMAIL ?? "partner@nido.demo";
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD ?? "nido-demo-2026";
/** PIN του demo (src/db/seed.ts → demoPins χωρίς NIDO_ADMIN_PIN). */
const PIN = { admin: "1234", manager: "4444", cashier: "2222", waiter: "1111" };
const PHONE = { viewport: { width: 390, height: 844 } };
const TABLET = { viewport: { width: 1280, height: 800 } };
/** Μοναδικό ανά εκτέλεση, ώστε οι εκδηλώσεις να ξεχωρίζουν αν το script ξανατρέξει στην ίδια βάση. */
const RUN = Date.now().toString(36).slice(-4);
const TRIP = { title: `Εκδρομή 2ο Δημοτικό Θέρμης ${RUN}`, guests: 25, phone: "2310123456", price: "250", menu: "Τοστ και φυσικός χυμός" };
const PARTY = { title: `Πάρτι Γιώργου ${RUN}`, child: "Γιώργος" };

fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const devices = [];
let shotNo = 0;
let currentStep = "";

/* ------------------------------ βοηθητικά ------------------------------ */

/** Ίδια μορφή με formatEuro (src/server/money.ts). */
const euro = (cents) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")} €`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function problem(msg) {
  errors.push(`[${currentStep}] ${msg}`);
  console.log(`  ✗ ${msg}`);
}
function check(ok, msg) {
  if (!ok) problem(msg);
  return !!ok;
}
async function step(name, fn) {
  currentStep = name;
  console.log(`▶ ${name}`);
  await fn();
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

/** Μία συσκευή = ένα browser context (δικά του cookies: σύνδεση χρήστη, ταμείο συσκευής). */
async function device(label, kind) {
  const ctx = await browser.newContext({ ...kind, locale: "el-GR", timezoneId: "Europe/Athens" });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problem(`${label}: pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problem(`${label}: console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problem(`${label}: HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  devices.push({ label, page });
  return page;
}

async function checkNoError(page, label) {
  const body = await page.locator("body").innerText().catch(() => "");
  for (const bad of ["Application error", "Unhandled Runtime Error", "This page could not be found", "Internal Server Error", "Something went wrong"]) {
    if (body.includes(bad)) problem(`${label}: «${bad}»`);
  }
}

/** Περιμένει να «ζωντανέψει» η σελίδα (React hydration): αλλιώς ένα γρήγορο κλικ χάνεται. */
async function hydrated(page) {
  await page
    .waitForFunction(() => {
      const b = document.querySelector("button");
      return !b || Object.keys(b).some((k) => k.startsWith("__reactProps"));
    }, null, { timeout: 15000 })
    .catch(() => problem(`${new URL(page.url()).pathname}: η σελίδα δεν έγινε διαδραστική (hydration)`));
}

async function visit(page, path, label = path) {
  const res = await page.goto(`${BASE}${path}`);
  if (res && res.status() >= 400) problem(`${label}: HTTP ${res.status()}`);
  await hydrated(page);
  await checkNoError(page, label);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotNo).padStart(2, "0")}-${name}.png`, fullPage: true });
}

async function loginPin(page, pin) {
  await visit(page, "/login");
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Είσοδος" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

const text = (loc) => loc.innerText().catch(() => "");
const modal = (page) => page.locator(".glass-modal").last();
/** Μήνυμα (toast) στο κάτω μέρος της οθόνης: μένει 2,6″, γι' αυτό ελέγχεται αμέσως μετά την ενέργεια. */
async function expectToast(page, substring, label) {
  await page
    .getByText(substring)
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => problem(`${label}: δεν εμφανίστηκε το μήνυμα «${substring}»`));
}
/** Περιμένει να περιέχει το στοιχείο όλα τα κείμενα (π.χ. ρέστα μετά από πληκτρολόγηση) και επιστρέφει το κείμενό του. */
async function waitText(loc, parts, msg) {
  const all = Array.isArray(parts) ? parts : [parts];
  let filtered = loc;
  for (const p of all) filtered = filtered.filter({ hasText: p });
  const ok = await filtered.first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  const got = (await text(loc.first())).replace(/\s+/g, " ").trim();
  if (!ok) problem(`${msg} (βρέθηκε: «${got}»)`);
  return got;
}
/** Τιμή μιας γραμμής <dt>/<dd> (σύνοψη βάρδιας). */
async function figure(scope, label) {
  const row = scope.locator("dl > div").filter({ has: scope.page().getByText(label, { exact: true }) });
  return (await text(row.locator("dd").first())).trim();
}

/* ------------------------------ ροές ------------------------------ */

const waiter = await device("σερβιτόρος", PHONE);
const admin = await device("διαχειριστής", TABLET);
const kitchen = await device("κουζίνα", TABLET);
const cashier = await device("ταμείο", TABLET);
const customer = await device("πελάτης QR", PHONE);
const partner = await device("συνεταίρος", PHONE);

try {
  await step("PDA: παραγγελία στο Κ2", async () => {
    await loginPin(waiter, PIN.waiter);
    await visit(waiter, "/pda");
    await shot(waiter, "pda-floor");
    await waiter.getByText("Κ2", { exact: true }).first().click();
    await waiter.waitForURL(/\/pda\/s\/\d+/, { timeout: 20000 });
    await hydrated(waiter);
    await checkNoError(waiter, "/pda/s");
    await waiter.getByRole("button", { name: /Αναψυκτικά/ }).click();
    await waiter.getByRole("button", { name: /^Coca-Cola 330ml/ }).click();
    await waiter.getByRole("button", { name: /Burger/ }).first().click();
    await waiter.getByRole("button", { name: /^Classic Burger/ }).click();
    await modal(waiter).getByRole("button", { name: /Extra τυρί/ }).click();
    await modal(waiter).getByRole("button", { name: /^Προσθήκη/ }).click();
    await waiter.getByRole("button", { name: /^Καλάθι/ }).click();
    await shot(waiter, "pda-cart");
    await modal(waiter).getByRole("button", { name: "Αποστολή στην κουζίνα" }).click();
    await waiter.getByText("Classic Burger").first().waitFor();
    await checkNoError(waiter, "/pda/s μετά την αποστολή");
    await shot(waiter, "pda-sent");
    const t = await text(waiter.locator("body"));
    check(t.includes("Extra τυρί") && t.includes("Coca-Cola 330ml"), "PDA: τα σταλμένα είδη δεν φαίνονται");
    // Τα ποσά του ταμείου πιο κάτω προϋποθέτουν ότι το Κ2 ήταν ελεύθερο (καθαρή βάση demo).
    if (!(await waiter.getByText("1 γύρος", { exact: true }).isVisible())) throw new Error("Το Κ2 είχε ήδη παραγγελία: τρέξε το script σε καθαρή βάση demo (άδειο PGLITE_DIR)");
  });

  await step("Διαχείριση: σχολική εκδρομή στο /admin/trips", async () => {
    await loginPin(admin, PIN.admin);
    await visit(admin, "/admin/trips");
    await admin.getByRole("heading", { name: "Σχολικές εκδρομές" }).waitFor();
    await admin.getByRole("button", { name: "+ Νέα εκδρομή" }).click();
    const m = modal(admin);
    await m.getByLabel("Τίτλος").fill(TRIP.title);
    check((await m.getByLabel("Τύπος").inputValue()) === "school_trip", "trips: η νέα εγγραφή δεν είναι «Σχολική εκδρομή»");
    await m.getByLabel("Καλεσμένοι").fill(String(TRIP.guests));
    await m.getByLabel("Πελάτης").fill("Δημοτικό Θέρμης");
    await m.getByLabel("Τηλέφωνο").fill(TRIP.phone);
    await m.getByLabel("Τιμή (€)").fill(TRIP.price);
    await m.getByLabel("Μενού / πακέτο").fill(TRIP.menu);
    await m.getByRole("button", { name: "Αποθήκευση", exact: true }).click();
    // Σε καθαρή βάση δεν υπάρχει σύμπτωση· αν το script ξανατρέξει, η προηγούμενη εκδρομή συμπίπτει.
    const again = m.getByRole("button", { name: "Αποθήκευση παρόλα αυτά" });
    const created = admin.getByText("Η εκδήλωση δημιουργήθηκε");
    await again.or(created).first().waitFor();
    if (await again.isVisible()) {
      await again.click();
      await expectToast(admin, "Η εκδήλωση δημιουργήθηκε", "trips");
    }
    await admin.locator("[data-testid=month-grid] button", { hasText: TRIP.title }).waitFor();
    const row = admin.locator("[data-testid=upcoming-list] li", { hasText: TRIP.title });
    await row.waitFor();
    check((await text(row)).includes("Αίτημα"), "trips: η νέα εκδρομή δεν είναι «Αίτημα»");
    await row.getByRole("button", { name: "Επιβεβαίωση" }).click();
    await expectToast(admin, `«${TRIP.title}»: Επιβεβαιωμένο`, "trips");
    await row.getByText("Επιβεβαιωμένο").waitFor();
    await checkNoError(admin, "/admin/trips");
    await shot(admin, "admin-trips");
  });

  await step("Διαχείριση: παιδικό πάρτι με σύμπτωση στο /admin/parties", async () => {
    await visit(admin, "/admin/parties");
    await admin.getByRole("heading", { name: "Παιδικά πάρτι" }).waitFor();
    check(!(await text(admin.locator("[data-testid=month-grid]"))).includes(TRIP.title), "parties: φαίνεται η σχολική εκδρομή στο ημερολόγιο πάρτι");
    await admin.getByRole("button", { name: "+ Νέο πάρτι" }).click();
    const m = modal(admin);
    await m.getByRole("heading", { name: "Νέο παιδικό πάρτι" }).waitFor();
    await m.getByLabel("Τίτλος").fill(PARTY.title);
    await m.getByLabel("Όνομα παιδιού").fill(PARTY.child);
    await m.getByRole("button", { name: "Αποθήκευση", exact: true }).click();
    // Πάρτι 11:00–13:30 και εκδρομή 12:00–16:00 την ίδια μέρα σε όλο τον χώρο: πρέπει να προειδοποιήσει.
    await m.getByText("Συμπίπτει με:").waitFor();
    check((await text(m)).includes(TRIP.title), "parties: η προειδοποίηση σύμπτωσης δεν αναφέρει την εκδρομή");
    await shot(admin, "admin-party-conflict");
    await m.getByRole("button", { name: "Αποθήκευση παρόλα αυτά" }).click();
    await expectToast(admin, "Η εκδήλωση δημιουργήθηκε", "parties");
    const chip = admin.locator("[data-testid=month-grid] button", { hasText: PARTY.title });
    await chip.waitFor();
    check((await text(chip)).includes("15π"), "parties: το πάρτι δεν δείχνει τα 15 παιδιά");
    await checkNoError(admin, "/admin/parties");
    await shot(admin, "admin-parties");
  });

  await step("Διαχείριση: /admin/ceremonies, /admin/events, /admin/trips (ποιο ημερολόγιο δείχνει τι)", async () => {
    await visit(admin, "/admin/ceremonies");
    await admin.getByRole("heading", { name: "Γάμοι & Βαπτίσεις" }).waitFor();
    const grid = await text(admin.locator("[data-testid=month-grid]"));
    check(!grid.includes(TRIP.title) && !grid.includes(PARTY.title), "ceremonies: φαίνονται εκδρομή ή πάρτι στο ημερολόγιο γάμων");
    await admin.getByRole("button", { name: "+ Νέα κράτηση / ραντεβού" }).click();
    const types = await modal(admin).getByLabel("Τύπος").locator("option").allInnerTexts();
    check(types.join("|") === "Γάμος|Βάφτιση|Ραντεβού", `ceremonies: τύποι στη φόρμα: ${types.join(", ")}`);
    await modal(admin).getByRole("button", { name: "Άκυρο" }).click();
    await shot(admin, "admin-ceremonies");

    await visit(admin, "/admin/events");
    await admin.getByRole("heading", { name: "Όλες οι εκδηλώσεις" }).waitFor();
    const all = await text(admin.locator("[data-testid=month-grid]"));
    check(all.includes(TRIP.title) && all.includes(PARTY.title), "events: δεν φαίνονται και η εκδρομή και το πάρτι");
    await shot(admin, "admin-events");

    await visit(admin, "/admin/trips");
    check(!(await text(admin.locator("[data-testid=month-grid]"))).includes(PARTY.title), "trips: φαίνεται το πάρτι στο ημερολόγιο εκδρομών");
  });

  await step("Προσωπικό: ημερολόγιο /pda/calendar (φίλτρα, χωρίς τιμές και τηλέφωνα)", async () => {
    const nav = (page) => page.getByRole("navigation", { name: "Κύριο μενού" });
    const list = waiter.locator("[data-testid=calendar-list]");
    const article = (title) => list.locator("article", { hasText: title });
    const filter = async (label, s) => {
      await waiter.getByRole("navigation", { name: "Είδος εκδήλωσης" }).getByRole("link", { name: label, exact: true }).click();
      await waiter.waitForURL((u) => (s ? u.searchParams.get("s") === s : !u.searchParams.has("s")));
      await hydrated(waiter);
      await checkNoError(waiter, `/pda/calendar ${label}`);
    };

    await nav(waiter).getByRole("link", { name: "Ημερολόγιο" }).click();
    await waiter.waitForURL(/\/pda\/calendar/);
    await hydrated(waiter);
    await checkNoError(waiter, "/pda/calendar");
    // «Όλα»: και η εκδρομή και το πάρτι. Επόμενη εκδήλωση: το πάρτι στις 11:00.
    const next = await text(waiter.locator("[data-testid=next-event]"));
    check(next.includes("Σήμερα") && next.includes(PARTY.title), `pda/calendar: λάθος «Επόμενη εκδήλωση» («${next.replace(/\s+/g, " ")}»)`);
    const trip = await text(article(TRIP.title));
    for (const v of ["Σχολική εκδρομή", "12:00–16:00", `${TRIP.guests} άτομα`, "Επιβεβαιωμένο", TRIP.menu, "Επικοινωνία: Δημοτικό Θέρμης"]) check(trip.includes(v), `pda/calendar: η εκδρομή δεν δείχνει «${v}»`);
    const party = await text(article(PARTY.title));
    for (const v of ["Πάρτι", "15 παιδιά · 15 ενήλικες", PARTY.child, "Αίτημα"]) check(party.includes(v), `pda/calendar: το πάρτι δεν δείχνει «${v}»`);
    const all = await text(list);
    check(!all.includes(TRIP.phone), "pda/calendar: ο σερβιτόρος βλέπει το τηλέφωνο του πελάτη");
    check(!all.includes("€"), "pda/calendar: ο σερβιτόρος βλέπει τιμές");
    check((await waiter.getByRole("link", { name: /Νέα εκδήλωση ή αλλαγή/ }).count()) === 0, "pda/calendar: ο σερβιτόρος έχει σύνδεσμο προς τη Διαχείριση");
    await shot(waiter, "pda-calendar");

    await filter("Εκδρομές", "trips");
    check((await article(TRIP.title).count()) === 1 && (await article(PARTY.title).count()) === 0, "pda/calendar: το φίλτρο «Εκδρομές» δεν δείχνει μόνο την εκδρομή");
    await filter("Πάρτι", "parties");
    check((await article(PARTY.title).count()) === 1 && (await article(TRIP.title).count()) === 0, "pda/calendar: το φίλτρο «Πάρτι» δεν δείχνει μόνο το πάρτι");
    await filter("Γάμοι & Βαπτίσεις", "ceremonies");
    check((await article(PARTY.title).count()) === 0 && (await article(TRIP.title).count()) === 0, "pda/calendar: το φίλτρο «Γάμοι & Βαπτίσεις» δείχνει πάρτι ή εκδρομή");
    await filter("Όλα", null);

    // Ο παλιός σύνδεσμος οδηγεί στο φίλτρο «Εκδρομές».
    await waiter.goto(`${BASE}/pda/trips`);
    const u = new URL(waiter.url());
    check(u.pathname === "/pda/calendar" && u.searchParams.get("s") === "trips", `το /pda/trips δεν οδηγεί στις εκδρομές του ημερολογίου (${u.pathname}${u.search})`);
    await waiter.goto(`${BASE}/admin/trips`);
    check(!new URL(waiter.url()).pathname.startsWith("/admin"), "ο σερβιτόρος άνοιξε το /admin/trips");

    // Ο υπεύθυνος: βλέπει τηλέφωνο και σύνδεσμο προς τη Διαχείριση· το «Ημερολόγιο» δεν είναι στο μενού του.
    await loginPin(kitchen, PIN.manager);
    await visit(kitchen, "/pda/calendar");
    check((await text(kitchen.locator("[data-testid=calendar-list]"))).includes(TRIP.phone), "pda/calendar: ο υπεύθυνος δεν βλέπει το τηλέφωνο");
    check((await kitchen.getByRole("link", { name: /Νέα εκδήλωση ή αλλαγή στη Διαχείριση/ }).count()) === 1, "pda/calendar: ο υπεύθυνος δεν έχει σύνδεσμο προς τη Διαχείριση");
    check((await nav(kitchen).getByRole("link", { name: "Ημερολόγιο" }).count()) === 0, "μενού: ο υπεύθυνος βλέπει «Ημερολόγιο» (είναι μόνο για προσωπικό)");
  });

  await step("Κουζίνα: ΕΤΟΙΜΟ για το Κ2", async () => {
    await visit(kitchen, "/kds");
    const bump = kitchen.getByRole("button", { name: "Έτοιμο, Κ2", exact: true });
    await bump.waitFor();
    await shot(kitchen, "kds-k2");
    await bump.click();
    await expectToast(kitchen, "Έτοιμη η παραγγελία Κ2", "kds Κ2");
    await bump.waitFor({ state: "detached" });
  });

  let saleNo = 0;
  const salesCount = async (n) => {
    await cashier.getByText(new RegExp(`· ${n} πωλήσεις$`)).waitFor({ timeout: 10000 }).catch(() => problem(`ταμείο: η μπάρα δεν δείχνει «${n} πωλήσεις»`));
  };
  const cats = () => cashier.getByRole("navigation", { name: "Κατηγορίες" });
  const cart = () => cashier.getByRole("complementary", { name: "Καλάθι" });
  const tap = async (category, product) => {
    await cats().getByRole("button", { name: category, exact: true }).click();
    await cashier.getByRole("region", { name: "Είδη" }).getByRole("button", { name: new RegExp(`^${escapeRe(product)}, `) }).click();
  };
  const withModifier = async (modifier) => {
    const m = modal(cashier);
    await m.getByRole("button", { name: modifier }).click();
    await m.getByRole("button", { name: /^Προσθήκη/ }).click();
    await m.waitFor({ state: "detached" });
  };
  const payMode = (scope, mode) => scope.getByRole("group", { name: "Τρόπος πληρωμής" }).getByRole("button", { name: mode, exact: true }).click();

  await step("Ταμείο: επιλογή ταμείου και άνοιγμα βάρδιας", async () => {
    await loginPin(cashier, PIN.cashier);
    await visit(cashier, "/cashier");
    await cashier.getByRole("heading", { name: "Ποιο ταμείο είναι αυτό;" }).waitFor();
    await shot(cashier, "cashier-registers");
    await cashier.getByRole("button", { name: /Ταμείο 1/ }).click();
    await cashier.getByText("Η βάρδια είναι κλειστή").waitFor();
    await hydrated(cashier);
    await cashier.getByPlaceholder("0,00").fill("50");
    await cashier.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 1" }).click();
    await cats().waitFor({ timeout: 20000 });
    await hydrated(cashier);
    await checkNoError(cashier, "/cashier");
    await salesCount(0);
    await cashier.getByRole("button", { name: "Προς πληρωμή (1)" }).waitFor();
    await shot(cashier, "cashier-till");
  });

  await step("Ταμείο: γρήγορη πώληση με μετρητά, ρέστα και βομβητή 7", async () => {
    await tap("Καφέδες", "Freddo Espresso");
    await withModifier("Μέτριος");
    await tap("Αναψυκτικά", "Coca-Cola 330ml");
    await tap("Burger", "Classic Burger");
    await withModifier(/Extra τυρί/);
    const c = cart();
    check((await text(c)).includes("Μέτριος"), "ταμείο: η επιλογή «Μέτριος» δεν φαίνεται στο καλάθι");
    await c.locator("#till-buzzer").fill("7");
    await c.getByRole("button", { name: `Πληρωμή ${euro(1500)}` }).click();
    await c.locator("#pay-cash-given").fill("20");
    await waitText(c.getByRole("status"), ["Ρέστα", euro(500)], `ταμείο: τα ρέστα δεν είναι ${euro(500)}`);
    await shot(cashier, "cashier-pay-cash");
    await c.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await waitText(c.locator("[data-testid=last-sale]"), ["Βομβητής 7", euro(1500), euro(500)], "ταμείο: λάθος σύνοψη πώλησης");
    await salesCount(++saleNo);
  });

  await step("Ταμείο: βομβητής σε χρήση, μετά πώληση με κάρτα και βομβητή 8", async () => {
    await tap("Αναψυκτικά", "Νερό 500ml");
    await tap("Παγωτά", "Παγωτό ξυλάκι");
    const c = cart();
    await c.locator("#till-buzzer").fill("7");
    await c.getByRole("button", { name: `Πληρωμή ${euro(300)}` }).click();
    await payMode(c, "Κάρτα");
    await c.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await expectToast(cashier, "Ο βομβητής 7 είναι ακόμη σε χρήση", "ταμείο");
    await c.getByRole("button", { name: "‹ Καλάθι" }).click();
    await c.locator("#till-buzzer").fill("8");
    await c.getByRole("button", { name: `Πληρωμή ${euro(300)}` }).click();
    await payMode(c, "Κάρτα");
    await c.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await waitText(c.locator("[data-testid=last-sale]"), ["Βομβητής 8", euro(300), "Χωρίς ρέστα"], "ταμείο: λάθος σύνοψη πώλησης με κάρτα");
    await salesCount(++saleNo);
  });

  await step("Ταμείο: πληρωμή του Κ2 από τα «Προς πληρωμή»", async () => {
    await cashier.getByRole("button", { name: "Προς πληρωμή (1)" }).click();
    const m = modal(cashier);
    await m.getByRole("button", { name: `Πληρωμή Κ2, ${euro(1200)}` }).click();
    await m.getByRole("heading", { name: "Πληρωμή · Κ2" }).waitFor();
    check((await text(m)).includes("Classic Burger"), "ταμείο: ο λογαριασμός του Κ2 δεν έχει τα είδη");
    await payMode(m, "Κάρτα");
    await m.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await expectToast(cashier, "Πληρώθηκε · Κ2", "ταμείο Κ2");
    await cashier.getByRole("button", { name: "Προς πληρωμή (0)" }).waitFor();
    await salesCount(++saleNo);
    await shot(cashier, "cashier-after-k2");
  });

  await step("Κουζίνα: βομβητές 7 και 8 (ΕΤΟΙΜΟ, οθόνη παραλαβών, Παραδόθηκε)", async () => {
    // Η κουζίνα ενημερώνεται μόνη της (ζωντανά ή κάθε 5″).
    const t7 = kitchen.locator("article").filter({ has: kitchen.locator('[aria-label="Βομβητής 7"]') });
    await t7.waitFor({ timeout: 20000 });
    const k7 = await text(t7);
    check(k7.includes("ΤΑΜΕΙΟ") && k7.includes("Freddo Espresso") && k7.includes("Classic Burger") && k7.includes("Μέτριος"), "kds: λάθος περιεχόμενο για τον βομβητή 7");
    await shot(kitchen, "kds-buzzers");
    await t7.getByRole("button", { name: "Έτοιμο, βομβητής 7" }).click();
    await expectToast(kitchen, "🔔 Χτύπα τον βομβητή 7", "kds");
    const t8 = kitchen.locator("article").filter({ has: kitchen.locator('[aria-label="Βομβητής 8"]') });
    await t8.getByRole("button", { name: "Έτοιμο, βομβητής 8" }).click();
    await expectToast(kitchen, "🔔 Χτύπα τον βομβητή 8", "kds");
    const ready = kitchen.locator('section[aria-labelledby="kds-ready"]');
    await ready.getByRole("button", { name: "Παραδόθηκε: Βομβητής 8" }).waitFor();
    await shot(kitchen, "kds-ready");

    await visit(kitchen, "/pickup");
    const col = kitchen.locator('section[data-column="ready"]');
    for (const n of [7, 8]) check((await col.locator(`[aria-label="Βομβητής ${n}"]`).count()) === 1, `pickup: ο βομβητής ${n} δεν είναι στις «ΕΤΟΙΜΕΣ»`);
    await shot(kitchen, "pickup-board");

    await visit(kitchen, "/kds");
    await kitchen.getByRole("button", { name: "Παραδόθηκε: Βομβητής 7" }).click();
    await kitchen.getByRole("button", { name: "Παραδόθηκε: Βομβητής 7" }).waitFor({ state: "detached" });

    // Το ταμείο βλέπει την έτοιμη παραγγελία χωρίς ανανέωση σελίδας και την παραδίδει.
    await cashier.getByRole("button", { name: "Έτοιμες (1)" }).click({ timeout: 20000 });
    await modal(cashier).getByRole("button", { name: "Παραδόθηκε: Βομβητής 8" }).click();
    await modal(cashier).getByText("Καμία έτοιμη παραγγελία δεν περιμένει.").waitFor();
    await modal(cashier).getByRole("button", { name: "Κλείσιμο", exact: true }).click();
  });

  await step("QR take-away: παραγγελία πελάτη, πληρωμή στο ταμείο με βομβητή 12, κουζίνα, παραλαβή", async () => {
    const q = customer;
    await visit(q, "/order");
    await q.getByRole("button", { name: /Burger/ }).first().click();
    await q.getByRole("button", { name: /Classic Burger/ }).first().click();
    await q.getByRole("button", { name: /Extra τυρί/ }).click();
    await q.getByRole("button", { name: /^Προσθήκη/ }).click();
    await q.getByRole("button", { name: /Coca-Cola 330ml/ }).first().click();
    await q.getByRole("button", { name: /Καλάθι/ }).click();
    await q.getByRole("heading", { name: "Το καλάθι σου" }).waitFor();
    await shot(q, "order-cart");
    await q.getByRole("button", { name: "Αποστολή παραγγελίας" }).click();
    await q.getByPlaceholder("π.χ. Κώστας").fill("Κώστας");
    await q.getByPlaceholder("69xxxxxxxx").fill("6912345678");
    await q.getByRole("button", { name: "Αποστολή παραγγελίας" }).click();
    await q.waitForURL(/\/order\/[A-Za-z0-9_-]{10,}$/, { timeout: 30000 });
    await hydrated(q);
    await checkNoError(q, "/order/[token]");
    const st = await text(q.locator("body"));
    const code = (st.match(/#(\d{3})/) || [])[1];
    check(code && st.includes("Ελήφθη"), "order: η σελίδα κατάστασης δεν δείχνει κωδικό ή «Ελήφθη»");
    await shot(q, "order-status");

    await cashier.getByRole("button", { name: "Προς πληρωμή (1)" }).click({ timeout: 20000 });
    const m = modal(cashier);
    await m.getByRole("button", { name: new RegExp(`^Πληρωμή #${code} Κώστας, ${euro(1200)}`) }).click();
    await m.locator("#order-buzzer").fill("12");
    await m.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await expectToast(cashier, "Πληρώθηκε · Βομβητής 12", "ταμείο QR");
    await salesCount(++saleNo);
    await q.getByText("✓ Πληρώθηκε").waitFor({ timeout: 20000 }).catch(() => problem("order: η πληρωμή δεν φάνηκε στον πελάτη"));

    const t12 = kitchen.locator("article").filter({ has: kitchen.locator('[aria-label="Βομβητής 12"]') });
    await t12.waitFor({ timeout: 20000 });
    check(!(await text(t12)).includes("ΔΕΝ ΕΧΕΙ ΠΛΗΡΩΘΕΙ"), "kds: η πληρωμένη παραγγελία QR φαίνεται απλήρωτη");
    await t12.getByRole("button", { name: "Έτοιμο, βομβητής 12" }).click();
    await expectToast(kitchen, "🔔 Χτύπα τον βομβητή 12", "kds QR");
    await q.getByText("Η παραγγελία σου είναι έτοιμη!").waitFor({ timeout: 20000 }).catch(() => problem("order: το «έτοιμη» δεν εμφανίστηκε ζωντανά"));
    check((await text(q.locator("body"))).includes("Πέρασε να την παραλάβεις."), "order: ο πελάτης δεν βλέπει ότι είναι πληρωμένη");
    await shot(q, "order-ready");

    await visit(kitchen, "/pickup");
    check((await kitchen.locator('section[data-column="ready"] [aria-label="Βομβητής 12"]').count()) === 1, "pickup: ο βομβητής 12 δεν είναι στις «ΕΤΟΙΜΕΣ»");

    await cashier.getByRole("button", { name: "Έτοιμες (1)" }).click({ timeout: 20000 });
    await modal(cashier).getByRole("button", { name: "Παραδόθηκε: Βομβητής 12" }).click();
    await modal(cashier).getByText("Καμία έτοιμη παραγγελία δεν περιμένει.").waitFor();
    await modal(cashier).getByRole("button", { name: "Κλείσιμο", exact: true }).click();
    await q.getByText("Ευχαριστούμε!").waitFor({ timeout: 20000 }).catch(() => problem("order: το «Ευχαριστούμε!» δεν εμφανίστηκε μετά την παράδοση"));
    await shot(q, "order-picked-up");
  });

  // 15,00 € μετρητά (βομβητής 7) + 12,00 € μετρητά (QR) · 3,00 € κάρτα (βομβητής 8) + 12,00 € κάρτα (Κ2)
  const expected = { sales: 4, cash: 2700, card: 1500, total: 4200, float: 5000, drawer: 7700, counted: 7650 };

  await step("Ταμείο: κλείσιμο με έλλειμμα 0,50 €", async () => {
    await cashier.getByRole("button", { name: "Κλείσιμο ταμείου" }).click();
    const m = modal(cashier);
    await m.getByRole("heading", { name: "Κλείσιμο ταμείου · Ταμείο 1" }).waitFor();
    const want = [
      ["Πωλήσεις", String(expected.sales)],
      ["Μετρητά (2)", euro(expected.cash)],
      ["Κάρτα (2)", euro(expected.card)],
      ["Σύνολο εισπράξεων", euro(expected.total)],
      ["Αρχικό ταμείο", euro(expected.float)],
      ["Αναμενόμενα μετρητά στο συρτάρι", euro(expected.drawer)],
    ];
    for (const [label, value] of want) {
      const got = await figure(m, label);
      check(got === value, `κλείσιμο: «${label}» = «${got}», αναμενόταν «${value}»`);
    }
    await m.getByLabel("Μετρητά που μέτρησες στο συρτάρι (€)").fill("76,50");
    await waitText(m.getByRole("status"), ["Έλλειμμα", euro(50)], `κλείσιμο: η διαφορά δεν είναι έλλειμμα ${euro(50)}`);
    await shot(cashier, "cashier-close");
    await m.getByRole("button", { name: "Κλείσιμο ταμείου", exact: true }).click();
    const report = cashier.getByRole("region", { name: "Σύνοψη βάρδιας" });
    await report.waitFor();
    check((await text(report)).includes("Διαφορά · Έλλειμμα"), "κλείσιμο: η σύνοψη δεν γράφει «Έλλειμμα»");
    const sd = (await text(report.getByTestId("shift-diff"))).trim();
    check(sd === `−${euro(50)}`, `κλείσιμο: διαφορά «${sd}», αναμενόταν «−${euro(50)}»`);
    check((await figure(report, "Μετρημένα μετρητά")) === euro(expected.counted), "κλείσιμο: λάθος μετρημένα μετρητά");
    await shot(cashier, "cashier-shift-report");
    await report.getByRole("button", { name: "Τέλος" }).click();
    await cashier.getByText("Η βάρδια είναι κλειστή").waitFor();
  });

  await step("Διαχείριση: Ταμεία ημέρας (/admin/registers)", async () => {
    await visit(admin, "/admin/registers");
    const table = admin.getByRole("table", { name: "Βάρδιες · Ταμείο 1" });
    await table.waitFor();
    const row = table.locator("tbody tr", { hasText: euro(expected.counted) }).last();
    const r = await text(row);
    for (const v of [euro(expected.cash), euro(expected.card), euro(expected.total), euro(expected.drawer), euro(50)]) check(r.includes(v), `registers: λείπει «${v}» από τη βάρδια (${r.replace(/\s+/g, " ")})`);
    await shot(admin, "admin-registers");
  });

  await step("Διαχείριση: όλες οι σελίδες", async () => {
    for (const r of [
      "/admin",
      "/admin/parties",
      "/admin/ceremonies",
      "/admin/trips",
      "/admin/events",
      "/admin/finance",
      "/admin/registers",
      "/admin/reports",
      "/admin/menu",
      "/admin/modifiers",
      "/admin/inventory",
      "/admin/floor",
      "/admin/tables",
      "/admin/qr",
      "/admin/staff",
      "/admin/printers",
      "/admin/partners",
      "/admin/settings",
      "/admin/audit",
    ]) {
      await visit(admin, r);
      await admin.locator("main").first().waitFor();
      await shot(admin, "admin" + r.replace(/\//g, "-"));
    }
    await visit(admin, "/admin/qr");
    const src = await admin.getByTestId("qr-image").getAttribute("src").catch(() => null);
    check(src?.startsWith("data:image/png"), "admin/qr: λείπει η εικόνα QR");
    await visit(admin, "/admin/staff");
    const eleni = admin.locator("tbody tr", { hasText: "Ελένη" });
    await eleni.getByRole("button", { name: "Εμφάνιση PIN" }).click();
    await waitText(eleni.locator(".tracking-widest"), PIN.manager, "admin/staff: δεν εμφανίστηκε το PIN της Ελένης");
  });

  await step("Συνεταίροι: dashboard", async () => {
    await partner.goto(`${BASE}/partners`);
    await partner.waitForURL(/\/partners\/login/);
    await hydrated(partner);
    await partner.fill('input[type="email"]', PARTNER_EMAIL);
    await partner.fill('input[type="password"]', PARTNER_PASSWORD);
    await partner.getByRole("button", { name: "Είσοδος" }).click();
    await partner.waitForURL(/\/partners$/, { timeout: 20000 });
    await hydrated(partner);
    await checkNoError(partner, "/partners");
    // Το dashboard δείχνει το snapshot του καταστήματος (κάθε 60″ και 10″ μετά από αλλαγή), όχι ζωντανά δεδομένα:
    // ανανέωση μέχρι να φανούν οι σημερινές πωλήσεις. textContent αντί innerText: οι ετικέτες είναι κεφαλαία με CSS.
    const content = () => partner.locator("body").evaluate((el) => el.textContent ?? "");
    const grossToday = (t) => {
      const m = t.match(/Τζίρος σήμερα\s*(-?[\d.]+),(\d{2}) €/);
      return m ? Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]) : null;
    };
    const deadline = Date.now() + 90000;
    let t = await content();
    while ((grossToday(t) ?? 0) < expected.total && Date.now() < deadline) {
      await partner.waitForTimeout(5000);
      await partner.reload();
      await hydrated(partner);
      t = await content();
    }
    check(t.includes("Πληρωμές σήμερα") && grossToday(t) !== null, "partners: λείπει το dashboard");
    check((grossToday(t) ?? 0) >= expected.total, `partners: τζίρος σήμερα ${euro(grossToday(t) ?? 0)}, αναμενόταν τουλάχιστον ${euro(expected.total)} (μετά από 90″)`);
    check(!t.includes("Καμία πληρωμή ακόμη"), "partners: δεν φαίνονται οι σημερινές πληρωμές");
    check(t.includes(TRIP.title) && t.includes(PARTY.title), "partners: οι επόμενες εκδηλώσεις δεν δείχνουν την εκδρομή και το πάρτι");
    await shot(partner, "partners");
  });
} catch (e) {
  problem(`ΔΙΑΚΟΠΗ: ${e.message}`);
  for (const { label, page } of devices) {
    if (!page.isClosed()) await page.screenshot({ path: `${OUT}/FAIL-${label.replace(/\s+/g, "-")}.png`, fullPage: true }).catch(() => {});
  }
} finally {
  await browser.close();
}

if (errors.length) {
  console.log(`\nERRORS (${errors.length}):\n` + errors.join("\n"));
  process.exit(1);
}
console.log("SMOKE OK");
