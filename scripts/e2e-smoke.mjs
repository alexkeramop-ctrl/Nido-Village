// End-to-end έλεγχος με Playwright πάνω στα δεδομένα επίδειξης (src/db/seed.ts), όπως δουλεύει το κατάστημα:
// χωρίς σερβιτόρο, 2 ταμεία, 2 μπαρ (Κέντρο, Παιδική), 1 κουζίνα, παραγγελίες QR ανά χώρο που πληρώνονται στο ταμείο.
//  1. Διαχείριση: ημερολόγια (/admin/trips, /admin/parties, /admin/ceremonies, /admin/events) — νέα εκδρομή, νέο πάρτι με σύμπτωση ώρας
//  2. Προσωπικό: ημερολόγιο /pda/calendar με φίλτρα (χωρίς τηλέφωνο/τιμές για ταμία), παλιό /pda/trips, όχι πρόσβαση στη Διαχείριση
//  3. Ταμείο 1: άνοιγμα με Μπαρ Κέντρο + QR Κέντρο & Παιδική· Ταμείο 2: Μπαρ Παιδική + QR Παιδική (τη μεταφέρει από το Ταμείο 1)
//  4. Πωλήσεις: μετρητά με ρέστα, κάρτα, βομβητής σε χρήση· κάθε ρόφημα στο μπαρ του ταμείου του, το φαγητό στην κουζίνα
//  5. Βομβητής: ΕΤΟΙΜΟ, οθόνη παραλαβών, «Παραδόθηκε» από κουζίνα και ταμείο
//  6. QR από την Παιδική: επιλογή χώρου, φαίνεται μόνο στο Ταμείο 2, πληρωμή με βομβητή, ρόφημα στο Μπαρ Παιδική, παραλαβή
//  7. Κλείσιμο Ταμείου 2 → το QR της Παιδικής κλείνει → το Ταμείο 1 την αναλαμβάνει μέσα στη βάρδια → ξανανοίγει
//  8. Κλείσιμο Ταμείου 1 με έλλειμμα, ποσά ανά ταμείο, /admin/registers
//  9. Όλες οι σελίδες της Διαχείρισης, QR ανά χώρο, PIN προσωπικού, dashboard συνεταίρων
// Σε κάθε σελίδα: pageerror, console error, HTTP ≥ 500 και μηνύματα σφάλματος του Next μετρούν ως αποτυχία.
//
// Χρήση (σε ΚΑΘΑΡΗ βάση demo, χωρίς NIDO_ADMIN_PIN, ώστε να ισχύουν τα PIN 1234/4444/2222):
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
const PIN = { admin: "1234", manager: "4444", cashier: "2222" };
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
  // Τα κουμπιά αλλάζουν χρώμα με κίνηση 150 ms: χωρίς αναμονή το στιγμιότυπο πιάνει τη μέση της.
  await page.waitForTimeout(250);
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

const staff = await device("προσωπικό", PHONE);
const admin = await device("διαχειριστής", TABLET);
const kitchen = await device("κουζίνα", TABLET);
const till1 = await device("ταμείο 1", TABLET);
const till2 = await device("ταμείο 2", TABLET);
const customer = await device("πελάτης QR", PHONE);
const partner = await device("συνεταίρος", PHONE);

/* --- βοηθητικά ταμείου (κάθε συσκευή-ταμείο έχει τα δικά της) --- */
const cats = (t) => t.getByRole("navigation", { name: "Κατηγορίες" });
const cart = (t) => t.getByRole("complementary", { name: "Καλάθι" });
const setupButton = (t) => t.getByRole("button", { name: /^Μπαρ και QR:/ });
const salesCount = async (t, n, who) => {
  await t
    .getByText(new RegExp(`· ${n} πωλήσεις$`))
    .waitFor({ timeout: 10000 })
    .catch(() => problem(`${who}: η μπάρα δεν δείχνει «${n} πωλήσεις»`));
};
const tap = async (t, category, product) => {
  await cats(t).getByRole("button", { name: category, exact: true }).click();
  await t.getByRole("region", { name: "Είδη" }).getByRole("button", { name: new RegExp(`^${escapeRe(product)}, `) }).click();
};
const withModifier = async (t, modifier) => {
  const m = modal(t);
  await m.getByRole("button", { name: modifier }).click();
  await m.getByRole("button", { name: /^Προσθήκη/ }).click();
  await m.waitFor({ state: "detached" });
};
const payMode = (scope, mode) => scope.getByRole("group", { name: "Τρόπος πληρωμής" }).getByRole("button", { name: mode, exact: true }).click();
const barGroup = (scope) => scope.getByRole("group", { name: "Τα ροφήματα βγαίνουν στο" });
const qrGroup = (scope) => scope.getByRole("group", { name: "Παραγγελίες QR από" });
const areaToggle = (scope, area) => qrGroup(scope).getByRole("button", { name: new RegExp(`^(✓ )?${escapeRe(area)}`) });
/** Η μπάρα του ταμείου δείχνει το μπαρ και τους χώρους QR της βάρδιας (περιμένει ζωντανή ενημέρωση έως 20″). */
const expectSetup = async (t, label, who) => {
  await t
    .getByRole("button", { name: `Μπαρ και QR: ${label}`, exact: true })
    .waitFor({ timeout: 20000 })
    .catch(async () => problem(`${who}: η μπάρα δεν δείχνει «${label}» (δείχνει «${await setupButton(t).getAttribute("aria-label").catch(() => "")}»)`));
};
/** Τα ποσά του παραθύρου «Κλείσιμο ταμείου». */
async function checkClose(t, who, want) {
  const m = modal(t);
  for (const [label, value] of want) {
    const got = await figure(m, label);
    check(got === value, `${who} κλείσιμο: «${label}» = «${got}», αναμενόταν «${value}»`);
  }
  return m;
}
/** Οι παραγγελίες της κουζίνας με φίλτρο σταθμού (Όλα, Κουζίνα, Μπαρ Κέντρο, Μπαρ Παιδική). */
async function kdsStation(name) {
  if (!new URL(kitchen.url()).pathname.startsWith("/kds")) await visit(kitchen, "/kds");
  // Πλήρης φόρτωση της σελίδας του σταθμού: με κλικ, η διεύθυνση αλλάζει πριν φανούν οι παραγγελίες του νέου σταθμού
  // και ένας έλεγχος εκείνη τη στιγμή διαβάζει ακόμη τον προηγούμενο.
  const href = await kitchen.getByRole("link", { name, exact: true }).getAttribute("href");
  await visit(kitchen, href, `/kds ${name}`);
}
const ticket = (n) => kitchen.locator("article").filter({ has: kitchen.locator(`[aria-label="Βομβητής ${n}"]`) });

try {
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
    const list = staff.locator("[data-testid=calendar-list]");
    const article = (title) => list.locator("article", { hasText: title });
    const filter = async (label, s) => {
      await staff.getByRole("navigation", { name: "Είδος εκδήλωσης" }).getByRole("link", { name: label, exact: true }).click();
      await staff.waitForURL((u) => (s ? u.searchParams.get("s") === s : !u.searchParams.has("s")));
      await hydrated(staff);
      await checkNoError(staff, `/pda/calendar ${label}`);
    };

    // Ταμίας στο κινητό του: βλέπει το «Ημερολόγιο» (μόνο ανάγνωση).
    await loginPin(staff, PIN.cashier);
    await visit(staff, "/cashier");
    await nav(staff).getByRole("link", { name: "Ημερολόγιο" }).click();
    await staff.waitForURL(/\/pda\/calendar/);
    await hydrated(staff);
    await checkNoError(staff, "/pda/calendar");
    // «Όλα»: και η εκδρομή και το πάρτι. Επόμενη εκδήλωση: το πάρτι στις 11:00.
    const next = await text(staff.locator("[data-testid=next-event]"));
    check(next.includes("Σήμερα") && next.includes(PARTY.title), `pda/calendar: λάθος «Επόμενη εκδήλωση» («${next.replace(/\s+/g, " ")}»)`);
    const trip = await text(article(TRIP.title));
    for (const v of ["Σχολική εκδρομή", "12:00–16:00", `${TRIP.guests} άτομα`, "Επιβεβαιωμένο", TRIP.menu, "Επικοινωνία: Δημοτικό Θέρμης"]) check(trip.includes(v), `pda/calendar: η εκδρομή δεν δείχνει «${v}»`);
    const party = await text(article(PARTY.title));
    for (const v of ["Πάρτι", "15 παιδιά · 15 ενήλικες", PARTY.child, "Αίτημα"]) check(party.includes(v), `pda/calendar: το πάρτι δεν δείχνει «${v}»`);
    const all = await text(list);
    check(!all.includes(TRIP.phone), "pda/calendar: ο ταμίας βλέπει το τηλέφωνο του πελάτη");
    check(!all.includes("€"), "pda/calendar: ο ταμίας βλέπει τιμές");
    check((await staff.getByRole("link", { name: /Νέα εκδήλωση ή αλλαγή/ }).count()) === 0, "pda/calendar: ο ταμίας έχει σύνδεσμο προς τη Διαχείριση");
    await shot(staff, "pda-calendar");

    await filter("Εκδρομές", "trips");
    check((await article(TRIP.title).count()) === 1 && (await article(PARTY.title).count()) === 0, "pda/calendar: το φίλτρο «Εκδρομές» δεν δείχνει μόνο την εκδρομή");
    await filter("Πάρτι", "parties");
    check((await article(PARTY.title).count()) === 1 && (await article(TRIP.title).count()) === 0, "pda/calendar: το φίλτρο «Πάρτι» δεν δείχνει μόνο το πάρτι");
    await filter("Γάμοι & Βαπτίσεις", "ceremonies");
    check((await article(PARTY.title).count()) === 0 && (await article(TRIP.title).count()) === 0, "pda/calendar: το φίλτρο «Γάμοι & Βαπτίσεις» δείχνει πάρτι ή εκδρομή");
    await filter("Όλα", null);

    // Ο παλιός σύνδεσμος οδηγεί στο φίλτρο «Εκδρομές».
    await staff.goto(`${BASE}/pda/trips`);
    const u = new URL(staff.url());
    check(u.pathname === "/pda/calendar" && u.searchParams.get("s") === "trips", `το /pda/trips δεν οδηγεί στις εκδρομές του ημερολογίου (${u.pathname}${u.search})`);
    await staff.goto(`${BASE}/admin/trips`);
    check(!new URL(staff.url()).pathname.startsWith("/admin"), "ο ταμίας άνοιξε το /admin/trips");

    // Ο υπεύθυνος: βλέπει τηλέφωνο και σύνδεσμο προς τη Διαχείριση· το «Ημερολόγιο» δεν είναι στο μενού του.
    await loginPin(kitchen, PIN.manager);
    await visit(kitchen, "/pda/calendar");
    check((await text(kitchen.locator("[data-testid=calendar-list]"))).includes(TRIP.phone), "pda/calendar: ο υπεύθυνος δεν βλέπει το τηλέφωνο");
    check((await kitchen.getByRole("link", { name: /Νέα εκδήλωση ή αλλαγή στη Διαχείριση/ }).count()) === 1, "pda/calendar: ο υπεύθυνος δεν έχει σύνδεσμο προς τη Διαχείριση");
    check((await nav(kitchen).getByRole("link", { name: "Ημερολόγιο" }).count()) === 0, "μενού: ο υπεύθυνος βλέπει «Ημερολόγιο» (είναι μόνο για προσωπικό)");
  });

  await step("Ταμείο 1: άνοιγμα με Μπαρ Κέντρο και QR από Κέντρο + Παιδική", async () => {
    await loginPin(till1, PIN.cashier);
    await visit(till1, "/cashier");
    await till1.getByRole("heading", { name: "Ποιο ταμείο είναι αυτό;" }).waitFor();
    // Τα ποσά πιο κάτω προϋποθέτουν καθαρή βάση: κανένα ταμείο ανοιχτό.
    if ((await till1.getByText("Ανοιχτή βάρδια").count()) > 0) throw new Error("Υπάρχει ήδη ανοιχτή βάρδια: τρέξε το script σε καθαρή βάση demo (άδειο PGLITE_DIR)");
    await shot(till1, "cashier-registers");
    await till1.getByRole("button", { name: /Ταμείο 1/ }).click();
    await till1.getByText("Η βάρδια είναι κλειστή").waitFor();
    await hydrated(till1);
    // Χωρίς μπαρ δεν ανοίγει.
    await till1.getByPlaceholder("0,00").fill("50");
    await till1.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 1" }).click();
    await expectToast(till1, "Διάλεξε σε ποιο μπαρ θα βγαίνουν τα ροφήματα", "ταμείο 1");
    check((await areaToggle(till1, "Κέντρο").getAttribute("aria-pressed")) === "false", "ταμείο 1: ο χώρος «Κέντρο» ήταν ήδη επιλεγμένος");
    await barGroup(till1).getByRole("button", { name: "Μπαρ Κέντρο", exact: true }).click();
    await areaToggle(till1, "Κέντρο").click();
    await areaToggle(till1, "Παιδική").click();
    await shot(till1, "cashier-open-setup");
    await till1.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 1" }).click();
    await cats(till1).waitFor({ timeout: 20000 });
    await hydrated(till1);
    await checkNoError(till1, "/cashier");
    await salesCount(till1, 0, "ταμείο 1");
    await expectSetup(till1, "Μπαρ Κέντρο · QR: Κέντρο, Παιδική", "ταμείο 1");
    if (!(await till1.getByRole("button", { name: "Προς πληρωμή (0)" }).isVisible())) throw new Error("Υπάρχουν εκκρεμείς παραγγελίες: τρέξε το script σε καθαρή βάση demo (άδειο PGLITE_DIR)");
    await shot(till1, "cashier-till-1");
  });

  await step("Ταμείο 2: άνοιγμα με Μπαρ Παιδική και QR από Παιδική (την παίρνει από το Ταμείο 1)", async () => {
    await loginPin(till2, PIN.manager);
    await visit(till2, "/cashier");
    await till2.getByRole("button", { name: /Ταμείο 2/ }).click();
    await till2.getByText("Η βάρδια είναι κλειστή").waitFor();
    await hydrated(till2);
    check((await text(areaToggle(till2, "Παιδική"))).includes("τώρα: Ταμείο 1"), "ταμείο 2: δεν φαίνεται ότι η Παιδική είναι στο Ταμείο 1");
    await barGroup(till2).getByRole("button", { name: "Μπαρ Παιδική", exact: true }).click();
    await areaToggle(till2, "Παιδική").click();
    check((await text(areaToggle(till2, "Παιδική"))).includes("θα μεταφερθεί από Ταμείο 1"), "ταμείο 2: δεν προειδοποιεί ότι η Παιδική θα μεταφερθεί");
    await shot(till2, "cashier-open-takeover");
    await till2.getByPlaceholder("0,00").fill("20");
    await till2.getByRole("button", { name: "Άνοιγμα βάρδιας · Ταμείο 2" }).click();
    await cats(till2).waitFor({ timeout: 20000 });
    await hydrated(till2);
    await expectSetup(till2, "Μπαρ Παιδική · QR: Παιδική", "ταμείο 2");
    // Το Ταμείο 1 ενημερώνεται μόνο του: έχασε την Παιδική.
    await expectSetup(till1, "Μπαρ Κέντρο · QR: Κέντρο", "ταμείο 1");
  });

  await step("Ταμείο 1: πώληση με μετρητά, ρέστα και βομβητή 7", async () => {
    await tap(till1, "Καφέδες", "Freddo Espresso");
    await withModifier(till1, "Μέτριος");
    await tap(till1, "Αναψυκτικά", "Coca-Cola 330ml");
    await tap(till1, "Burger", "Classic Burger");
    await withModifier(till1, /Extra τυρί/);
    const c = cart(till1);
    check((await text(c)).includes("Μέτριος"), "ταμείο 1: η επιλογή «Μέτριος» δεν φαίνεται στο καλάθι");
    await c.locator("#till-buzzer").fill("7");
    await c.getByRole("button", { name: `Πληρωμή ${euro(1500)}` }).click();
    await c.locator("#pay-cash-given").fill("20");
    await waitText(c.getByRole("status"), ["Ρέστα", euro(500)], `ταμείο 1: τα ρέστα δεν είναι ${euro(500)}`);
    await shot(till1, "cashier-pay-cash");
    await c.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await waitText(c.locator("[data-testid=last-sale]"), ["Βομβητής 7", euro(1500), euro(500)], "ταμείο 1: λάθος σύνοψη πώλησης");
    await salesCount(till1, 1, "ταμείο 1");
  });

  await step("Ταμείο 2: βομβητής σε χρήση, μετά πώληση με κάρτα και βομβητή 8", async () => {
    await tap(till2, "Αναψυκτικά", "Νερό 500ml");
    await tap(till2, "Παγωτά", "Παγωτό ξυλάκι");
    const c = cart(till2);
    await c.locator("#till-buzzer").fill("7");
    await c.getByRole("button", { name: `Πληρωμή ${euro(300)}` }).click();
    await payMode(c, "Κάρτα");
    await c.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await expectToast(till2, "Ο βομβητής 7 είναι ακόμη σε χρήση", "ταμείο 2");
    await c.getByRole("button", { name: "‹ Καλάθι" }).click();
    await c.locator("#till-buzzer").fill("8");
    await c.getByRole("button", { name: `Πληρωμή ${euro(300)}` }).click();
    await payMode(c, "Κάρτα");
    await c.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await waitText(c.locator("[data-testid=last-sale]"), ["Βομβητής 8", euro(300), "Χωρίς ρέστα"], "ταμείο 2: λάθος σύνοψη πώλησης με κάρτα");
    await salesCount(till2, 1, "ταμείο 2");
  });

  await step("Κουζίνα και μπαρ: κάθε δελτίο στον σωστό σταθμό", async () => {
    await visit(kitchen, "/kds");
    await kdsStation("Μπαρ Κέντρο");
    await ticket(7).waitFor({ timeout: 20000 });
    const k7 = await text(ticket(7));
    check(k7.includes("Freddo Espresso") && k7.includes("Coca-Cola 330ml") && !k7.includes("Classic Burger"), "Μπαρ Κέντρο: ο βομβητής 7 δεν έχει μόνο τα ροφήματα του Ταμείου 1");
    check((await ticket(8).count()) === 0, "Μπαρ Κέντρο: φαίνεται η πώληση του Ταμείου 2 (βομβητής 8)");
    await shot(kitchen, "kds-bar-kentro");
    await kdsStation("Μπαρ Παιδική");
    await ticket(8).waitFor({ timeout: 20000 });
    const k8 = await text(ticket(8));
    check(k8.includes("Νερό 500ml") && k8.includes("Παγωτό ξυλάκι"), "Μπαρ Παιδική: λείπουν τα είδη του βομβητή 8");
    check((await ticket(7).count()) === 0, "Μπαρ Παιδική: φαίνεται η πώληση του Ταμείου 1 (βομβητής 7)");
    await shot(kitchen, "kds-bar-paidiki");
    await kdsStation("Κουζίνα");
    const kk = await text(ticket(7));
    check(kk.includes("Classic Burger") && !kk.includes("Coca-Cola"), "Κουζίνα: ο βομβητής 7 δεν έχει μόνο το burger");
    check((await ticket(8).count()) === 0, "Κουζίνα: φαίνεται ο βομβητής 8 (μόνο ροφήματα/παγωτό)");
  });

  await step("Βομβητές 7 και 8: ΕΤΟΙΜΟ, οθόνη παραλαβών, Παραδόθηκε", async () => {
    await kdsStation("Όλα");
    await ticket(7).getByRole("button", { name: "Έτοιμο, βομβητής 7" }).click();
    await expectToast(kitchen, "🔔 Χτύπα τον βομβητή 7", "kds");
    await ticket(8).getByRole("button", { name: "Έτοιμο, βομβητής 8" }).click();
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

    // Το Ταμείο 2 βλέπει την έτοιμη παραγγελία του χωρίς ανανέωση σελίδας και την παραδίδει.
    await till2.getByRole("button", { name: "Έτοιμες (1)" }).click({ timeout: 20000 });
    await modal(till2).getByRole("button", { name: "Παραδόθηκε: Βομβητής 8" }).click();
    await modal(till2).getByText("Καμία έτοιμη παραγγελία δεν περιμένει.").waitFor();
    await modal(till2).getByRole("button", { name: "Κλείσιμο", exact: true }).click();
  });

  let paidikiUrl = "";
  await step("QR από την Παιδική: φαίνεται μόνο στο Ταμείο 2, πληρώνεται με βομβητή 12, ρόφημα στο Μπαρ Παιδική", async () => {
    const q = customer;
    // Το κοινό QR ρωτά πού κάθεται ο πελάτης.
    await visit(q, "/order");
    await q.getByRole("heading", { name: "Πού κάθεσαι;" }).waitFor();
    await shot(q, "order-choose-area");
    await q.getByRole("link", { name: /^Παιδική/ }).click();
    await q.waitForURL(/\/order\?a=\d+/);
    paidikiUrl = q.url();
    await hydrated(q);
    check((await text(q.getByTestId("order-area"))) === "Παιδική", "order: δεν φαίνεται ο χώρος «Παιδική»");
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

    await till2.getByRole("button", { name: "Προς πληρωμή (1)" }).click({ timeout: 20000 });
    // Το Ταμείο 1 δεν δέχεται πια την Παιδική: δεν τη βλέπει (νέα φόρτωση από τον server, όχι από τη μνήμη του browser).
    await visit(till1, "/cashier");
    await cats(till1).waitFor();
    check(await till1.getByRole("button", { name: "Προς πληρωμή (0)" }).isVisible(), "ταμείο 1: βλέπει την παραγγελία QR της Παιδικής");
    const m = modal(till2);
    const pay = m.getByRole("button", { name: new RegExp(`^Πληρωμή #${code} Κώστας, ${euro(1200)}`) });
    check((await text(pay)).includes("QR · Παιδική"), "ταμείο 2: η παραγγελία δεν γράφει «QR · Παιδική»");
    await pay.click();
    await m.locator("#order-buzzer").fill("12");
    await m.getByRole("button", { name: "Ολοκλήρωση" }).click();
    await expectToast(till2, "Πληρώθηκε · Βομβητής 12", "ταμείο 2 QR");
    await salesCount(till2, 2, "ταμείο 2");
    await q.getByText("✓ Πληρώθηκε").waitFor({ timeout: 20000 }).catch(() => problem("order: η πληρωμή δεν φάνηκε στον πελάτη"));

    await kdsStation("Μπαρ Παιδική");
    await ticket(12).waitFor({ timeout: 20000 });
    check((await text(ticket(12))).includes("Coca-Cola 330ml"), "Μπαρ Παιδική: λείπει το ρόφημα της παραγγελίας QR");
    await kdsStation("Μπαρ Κέντρο");
    check((await ticket(12).count()) === 0, "Μπαρ Κέντρο: φαίνεται το ρόφημα της παραγγελίας QR της Παιδικής");
    await kdsStation("Όλα");
    check(!(await text(ticket(12))).includes("ΔΕΝ ΕΧΕΙ ΠΛΗΡΩΘΕΙ"), "kds: η πληρωμένη παραγγελία QR φαίνεται απλήρωτη");
    await ticket(12).getByRole("button", { name: "Έτοιμο, βομβητής 12" }).click();
    await expectToast(kitchen, "🔔 Χτύπα τον βομβητή 12", "kds QR");
    await q.getByText("Η παραγγελία σου είναι έτοιμη!").waitFor({ timeout: 20000 }).catch(() => problem("order: το «έτοιμη» δεν εμφανίστηκε ζωντανά"));
    check((await text(q.locator("body"))).includes("Πέρασε να την παραλάβεις."), "order: ο πελάτης δεν βλέπει ότι είναι πληρωμένη");
    await shot(q, "order-ready");

    await till2.getByRole("button", { name: "Έτοιμες (1)" }).click({ timeout: 20000 });
    await modal(till2).getByRole("button", { name: "Παραδόθηκε: Βομβητής 12" }).click();
    await modal(till2).getByText("Καμία έτοιμη παραγγελία δεν περιμένει.").waitFor();
    await modal(till2).getByRole("button", { name: "Κλείσιμο", exact: true }).click();
    await q.getByText("Ευχαριστούμε!").waitFor({ timeout: 20000 }).catch(() => problem("order: το «Ευχαριστούμε!» δεν εμφανίστηκε μετά την παράδοση"));
    await shot(q, "order-picked-up");
  });

  await step("Ταμείο 2: κλείσιμο χωρίς διαφορά (Παιδική κλείνει για QR)", async () => {
    await till2.getByRole("button", { name: "Κλείσιμο ταμείου" }).click();
    await modal(till2).getByRole("heading", { name: "Κλείσιμο ταμείου · Ταμείο 2" }).waitFor();
    // 3,00 € κάρτα (βομβητής 8) + 12,00 € μετρητά (QR) · αρχικό 20,00 €
    const m = await checkClose(till2, "ταμείο 2", [
      ["Πωλήσεις", "2"],
      ["Μετρητά (1)", euro(1200)],
      ["Κάρτα (1)", euro(300)],
      ["Σύνολο εισπράξεων", euro(1500)],
      ["Αρχικό ταμείο", euro(2000)],
      ["Αναμενόμενα μετρητά στο συρτάρι", euro(3200)],
    ]);
    check((await text(m)).includes("δεν θα γίνονται δεκτές παραγγελίες QR από: Παιδική"), "ταμείο 2: το κλείσιμο δεν προειδοποιεί ότι η Παιδική κλείνει για QR");
    await m.getByLabel("Μετρητά που μέτρησες στο συρτάρι (€)").fill("32");
    await waitText(m.getByRole("status"), ["Συμφωνεί"], "ταμείο 2: η διαφορά δεν είναι «Συμφωνεί»");
    await m.getByRole("button", { name: "Κλείσιμο ταμείου", exact: true }).click();
    const report = till2.getByRole("region", { name: "Σύνοψη βάρδιας" });
    await report.waitFor();
    check((await text(report.getByTestId("shift-diff"))).trim() === euro(0), "ταμείο 2: η διαφορά δεν είναι 0,00 €");
    await shot(till2, "cashier-2-report");
    await report.getByRole("button", { name: "Τέλος" }).click();
    await till2.getByText("Η βάρδια είναι κλειστή").waitFor();
  });

  await step("QR Παιδικής κλειστό → το Ταμείο 1 την αναλαμβάνει μέσα στη βάρδια", async () => {
    await customer.goto(paidikiUrl);
    await hydrated(customer);
    await customer.getByTestId("order-closed").waitFor();
    check((await customer.getByRole("button", { name: /^Καλάθι/ }).count()) === 0, "order: ο χώρος είναι κλειστός αλλά φαίνεται το καλάθι");
    await shot(customer, "order-area-closed");
    await visit(customer, "/order");
    check((await text(customer.getByRole("link", { name: /^Παιδική/ }))).includes("παραγγελία στο ταμείο"), "order: η επιλογή χώρου δεν δείχνει την Παιδική ως κλειστή");

    await setupButton(till1).click();
    const m = modal(till1);
    await m.getByRole("heading", { name: "Μπαρ και QR · Ταμείο 1" }).waitFor();
    await areaToggle(m, "Παιδική").waitFor();
    check((await areaToggle(m, "Παιδική").getAttribute("aria-pressed")) === "false", "ταμείο 1: η Παιδική φαίνεται ήδη επιλεγμένη");
    await areaToggle(m, "Παιδική").click();
    await m.getByRole("button", { name: "Αποθήκευση", exact: true }).click();
    await expectToast(till1, "Αποθηκεύτηκε", "ταμείο 1");
    await expectSetup(till1, "Μπαρ Κέντρο · QR: Κέντρο, Παιδική", "ταμείο 1");

    await customer.goto(paidikiUrl);
    await hydrated(customer);
    check((await customer.getByTestId("order-closed").count()) === 0, "order: η Παιδική έμεινε κλειστή αφού την ανέλαβε το Ταμείο 1");
    check(await customer.getByRole("button", { name: /^Καλάθι/ }).isVisible(), "order: δεν φαίνεται το καλάθι στην ανοιχτή Παιδική");
  });

  await step("Ταμείο 1: κλείσιμο με έλλειμμα 0,50 €", async () => {
    await till1.getByRole("button", { name: "Κλείσιμο ταμείου" }).click();
    await modal(till1).getByRole("heading", { name: "Κλείσιμο ταμείου · Ταμείο 1" }).waitFor();
    // 15,00 € μετρητά (βομβητής 7) · αρχικό 50,00 €
    const m = await checkClose(till1, "ταμείο 1", [
      ["Πωλήσεις", "1"],
      ["Μετρητά (1)", euro(1500)],
      ["Κάρτα (0)", euro(0)],
      ["Σύνολο εισπράξεων", euro(1500)],
      ["Αρχικό ταμείο", euro(5000)],
      ["Αναμενόμενα μετρητά στο συρτάρι", euro(6500)],
    ]);
    await m.getByLabel("Μετρητά που μέτρησες στο συρτάρι (€)").fill("64,50");
    await waitText(m.getByRole("status"), ["Έλλειμμα", euro(50)], `ταμείο 1: η διαφορά δεν είναι έλλειμμα ${euro(50)}`);
    await shot(till1, "cashier-1-close");
    await m.getByRole("button", { name: "Κλείσιμο ταμείου", exact: true }).click();
    const report = till1.getByRole("region", { name: "Σύνοψη βάρδιας" });
    await report.waitFor();
    check((await text(report)).includes("Διαφορά · Έλλειμμα"), "ταμείο 1: η σύνοψη δεν γράφει «Έλλειμμα»");
    const sd = (await text(report.getByTestId("shift-diff"))).trim();
    check(sd === `−${euro(50)}`, `ταμείο 1: διαφορά «${sd}», αναμενόταν «−${euro(50)}»`);
    check((await figure(report, "Μετρημένα μετρητά")) === euro(6450), "ταμείο 1: λάθος μετρημένα μετρητά");
    await shot(till1, "cashier-1-report");
    await report.getByRole("button", { name: "Τέλος" }).click();
    await till1.getByText("Η βάρδια είναι κλειστή").waitFor();
  });

  await step("Διαχείριση: Ταμεία ημέρας (/admin/registers)", async () => {
    await visit(admin, "/admin/registers");
    const rowOf = async (register, counted) => {
      const table = admin.getByRole("table", { name: `Βάρδιες · ${register}` });
      await table.waitFor();
      return (await text(table.locator("tbody tr", { hasText: euro(counted) }).last())).replace(/\s+/g, " ");
    };
    const r1 = await rowOf("Ταμείο 1", 6450);
    for (const v of [euro(1500), euro(5000), euro(6500), euro(50)]) check(r1.includes(v), `registers: λείπει «${v}» από τη βάρδια του Ταμείου 1 (${r1})`);
    const r2 = await rowOf("Ταμείο 2", 3200);
    for (const v of [euro(1200), euro(300), euro(1500), euro(2000)]) check(r2.includes(v), `registers: λείπει «${v}» από τη βάρδια του Ταμείου 2 (${r2})`);
    await shot(admin, "admin-registers");
  });

  await step("Διαχείριση: όλες οι σελίδες, QR ανά χώρο, PIN προσωπικού", async () => {
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
      "/admin/costing",
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
    // Κοστολόγηση: τα demo προϊόντα έχουν συνταγές, οπότε βγαίνει food cost και drink cost.
    await visit(admin, "/admin/costing");
    await admin.getByTestId("costing-rows").waitFor();
    for (const k of ["food", "drink"]) {
      const txt = await admin.getByTestId(`summary-${k}`).innerText();
      check(/\d+,\d%/.test(txt), `admin/costing: δεν υπολογίστηκε ${k} cost`);
    }
    await visit(admin, "/admin/qr");
    const choices = await admin.getByRole("group", { name: "QR για" }).getByRole("button").allInnerTexts();
    check(choices.join("|") === "Κέντρο|Παιδική|Κοινό (ρωτά πού κάθεται)", `admin/qr: επιλογές QR: ${choices.join(", ")}`);
    await admin.getByRole("group", { name: "QR για" }).getByRole("button", { name: "Παιδική", exact: true }).click();
    const link = await text(admin.locator("code").first());
    check(paidikiUrl.endsWith(new URL(link).search) && /\/order\?a=\d+$/.test(link), `admin/qr: ο σύνδεσμος της Παιδικής είναι «${link}»`);
    const src = await admin.getByTestId("qr-image").getAttribute("src").catch(() => null);
    check(src?.startsWith("data:image/png"), "admin/qr: λείπει η εικόνα QR");
    await shot(admin, "admin-qr-paidiki");
    await visit(admin, "/admin/staff");
    const eleni = admin.locator("tbody tr", { hasText: "Ελένη" });
    await eleni.getByRole("button", { name: "Εμφάνιση PIN" }).click();
    await waitText(eleni.locator(".tracking-widest"), PIN.manager, "admin/staff: δεν εμφανίστηκε το PIN της Ελένης");
  });

  await step("Συνεταίροι: dashboard", async () => {
    // 15,00 € (Ταμείο 1) + 15,00 € (Ταμείο 2)
    const dayTotal = 3000;
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
    while ((grossToday(t) ?? 0) < dayTotal && Date.now() < deadline) {
      await partner.waitForTimeout(5000);
      await partner.reload();
      await hydrated(partner);
      t = await content();
    }
    check(t.includes("Πληρωμές σήμερα") && grossToday(t) !== null, "partners: λείπει το dashboard");
    check((grossToday(t) ?? 0) >= dayTotal, `partners: τζίρος σήμερα ${euro(grossToday(t) ?? 0)}, αναμενόταν τουλάχιστον ${euro(dayTotal)} (μετά από 90″)`);
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
