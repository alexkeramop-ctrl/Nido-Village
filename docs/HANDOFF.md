# Nido Village POS — Έγγραφο παράδοσης (handoff) για νέα συνομιλία

> Σκοπός: να μεταφερθεί όλο το context σε νέα συνομιλία ώστε να ολοκληρωθεί το **online στήσιμο** (βάση δεδομένων + Vercel) και να συνεχιστεί η ανάπτυξη. Κάνε paste ολόκληρο το αρχείο στην πρώτη σου εντολή.

## 1. Τι είναι

Λογισμικό για το **Nido Village** (οικογενειακός χώρος εστίασης με παιδότοπο, πισίνα, γήπεδο 5x5): παραγγελιοληψία με PDA, δύο μπαρ, κουζίνα με εκτυπωτές, ταμείο, αποθήκη με συνταγές και έλεγχο απόκλισης μπαρ, χάρτης χώρου πάνω στην αεροφωτογραφία, παραγγελία πελάτη από QR (take away), οθόνη παραλαβών, ημερολόγιο εκδηλώσεων, αναφορές, και online dashboard για τους συνεταίρους.

- **Repo:** https://github.com/alexkeramop-ctrl/Nido-Village
- **Branch εργασίας και default branch του repo:** `claude/wizardly-fermi-sscf43`
- **Τελευταίο commit:** `ed1cf19` (όλα τα παρακάτω είναι μέσα)
- **Ιδιοκτήτης:** alexkeramop-ctrl (GitHub), Vercel team «alexkeramop-4399's projects», Supabase org «Nido Vilage»

## 2. Stack

- Next.js 16.3 (App Router, Turbopack, `proxy.ts` αντί middleware), React 19, TypeScript strict, Tailwind v4
- Drizzle ORM. Βάση: **PGlite** (ενσωματωμένη Postgres) τοπικά χωρίς ρύθμιση, ή **PostgreSQL** με `DATABASE_URL` (Supabase/Neon). Τα migrations (`drizzle/0000..0003`) τρέχουν αυτόματα στην εκκίνηση.
- Σύνδεση υπαλλήλων με PIN (scrypt hash + AES-GCM κρυπτογραφημένο αντίγραφο για «Εμφάνιση PIN»), JWT cookie (`jose`)
- Realtime με Server-Sent Events (`/api/events`), εκτυπώσεις ESC/POS (raw TCP 9100) με ελληνικές κωδικοσελίδες, QR και λογότυπο (raster)
- Tests: vitest (36 tests, PGlite στη μνήμη). End-to-end: `scripts/e2e-smoke.mjs` (Playwright)
- Docker: `Dockerfile` + `docker-compose.yml` (εφαρμογή + Postgres) για box στο κατάστημα

Εντολές: `npm install`, `npm run dev` (http://localhost:3000), `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## 3. Οθόνες (routes)

| Route | Τι κάνει | Ρόλοι |
|---|---|---|
| `/login` | Σύνδεση με PIN (numpad) | όλοι |
| `/pda` | Κάτοψη: χάρτης χώρου με νούμερα τραπεζιών ή λίστα, πακέτα | σερβιτόρος και άνω (και μπαρ) |
| `/pda/s/[id]` | Παραγγελία τραπεζιού: μενού, επιλογές, σημειώσεις, ακυρώσεις, λογαριασμός, μεταφορά | ίδιο |
| `/kds` | Ενεργές παραγγελίες ανά σταθμό, «ΕΤΟΙΜΟ» | **μόνο υπεύθυνος/διαχειριστής** (κουζίνα/μπαρ δουλεύουν με χαρτάκια) |
| `/cashier`, `/cashier/s/[id]` | Ταμείο: βάρδια, λογαριασμός, έκπτωση, πληρωμή (μετρητά/κάρτα/split), «Έτοιμη»/«Παραδόθηκε» για QR | ταμίας και άνω |
| `/order`, `/order/[token]` | **Δημόσιο**: παραγγελία πελάτη από QR, σελίδα κατάστασης με ζωντανή ειδοποίηση «έτοιμη» (δόνηση/ήχος/notification) | χωρίς login |
| `/pickup` | **Δημόσιο**: οθόνη παραλαβών για τηλεόραση στο ταμείο | χωρίς login |
| `/admin` | Επισκόπηση (τζίρος, ανοιχτά, κουζίνα, εκτυπωτές, cloud, επόμενες εκδηλώσεις) | υπεύθυνος/διαχειριστής |
| `/admin/menu`, `/admin/modifiers` | Μενού, κατηγορίες, είδη, επιλογές, με διαγραφή | |
| `/admin/tables`, `/admin/floor` | Χώροι/τραπέζια (+ «Μπαρ χώρου»), χάρτης drag & drop πάνω σε εικόνα, ανέβασμα εικόνας | |
| `/admin/staff` | Προσωπικό, ρόλοι, PIN (εμφάνιση/διαγραφή) | μόνο διαχειριστής |
| `/admin/printers` | Σταθμοί εκτύπωσης (console/tcp), δοκιμαστική εκτύπωση, ουρά, προεπισκόπηση | |
| `/admin/inventory` | Απόθεμα, παραλαβές, απογραφή (και σε συσκευασίες), κινήσεις, προμηθευτές, κατανάλωση/απόκλιση (σε μερίδες και €) | |
| `/admin/recipes` | Συνταγές ανά είδος και επιλογή, κόστος/περιθώριο | |
| `/admin/reports` | Πωλήσεις ανά ημέρα/ώρα/είδος/κατηγορία/σερβιτόρο, ΦΠΑ, εκτύπωση | |
| `/admin/qr` | QR για εκτύπωση, λίστα παραγγελιών QR | |
| `/admin/events` | Ημερολόγιο εκδηλώσεων (γάμοι, βαφτίσεις, πάρτι, σχολικές εκδρομές, εταιρικά), διπλή κράτηση | |
| `/admin/partners`, `/admin/settings`, `/admin/audit` | Χρήστες συνεταίρων, στοιχεία/ΦΠΑ/cloud, ιστορικό ενεργειών | διαχειριστής |
| `/partners`, `/partners/login` | Online dashboard συνεταίρων (μόνο ανάγνωση) | χρήστες συνεταίρων |
| `/api/sync` | Δέχεται snapshot στατιστικών από το κατάστημα (cloud mode) | κλειδί `CLOUD_SYNC_KEY` |

**Demo δεδομένα (φορτώνονται αυτόματα σε άδεια βάση):** PIN 1234 διαχειριστής (Αλέξης), 4444 υπεύθυνος, 2222 ταμίας, 1111 σερβιτόρος, 3333 μπαρ Κέντρο, 5555 μπαρ Παιδική. Συνεταίροι: `partner@nido.demo` / `nido-demo-2026`. Μενού: Καφέδες, Αναψυκτικά, Smoothies, Παγωτά, Burger, Πίτσα, Club Sandwich, Ποτά. Χώροι: Κέντρο (Κ1–Κ30, μπαρ Κέντρο), Παιδική (Π1–Π20, μπαρ Παιδική). Η αεροφωτογραφία και το λογότυπο είναι μέσα στο repo (`src/db/seed-assets/`, `public/brand/`).

## 4. Κατάσταση online στησίματος (ΤΟ ΖΗΤΟΥΜΕΝΟ)

### Vercel
- Project **`nido-village`** (id `prj_KquHtfmc1rFzRowYpDyKwMQ1kq9k`) υπάρχει, συνδεδεμένο με το GitHub repo, κάνει αυτόματο deploy σε κάθε push στο branch `claude/wizardly-fermi-sscf43`. URL: https://nido-village.vercel.app
- **Χωρίς βάση ακόμη.** Χωρίς `DATABASE_URL` η εφαρμογή τρέχει σε Vercel με προσωρινή βάση στη μνήμη ανά στιγμιότυπο → φαινόμενα «Η συνεδρία δεν βρέθηκε», κατηγορίες που «αλλάζουν μόνες τους». **Δεν είναι bug κώδικα· λύνεται μόνο με πραγματική βάση.**
- Το Vercel MCP token της προηγούμενης συνομιλίας **δεν είχε δικαίωμα** δημιουργίας project, μεταβλητών περιβάλλοντος ή αλλαγής ρυθμίσεων (403). Αυτά γίνονται από το Vercel dashboard από τον ιδιοκτήτη.
- **Deployment Protection**: είναι ενεργή η «Vercel Authentication», άρα το link ανοίγει μόνο για συνδεδεμένους στο Vercel. Για δημόσια πρόσβαση: Project → Settings → Deployment Protection → Vercel Authentication → Disabled.

### Βάση δεδομένων (διάλεξε ένα)
1. **Neon μέσω Vercel (προτείνεται, 0 €):** Vercel → project nido-village → Storage → Create Database → Neon (Free) → Connect to project. Το integration βάζει `DATABASE_URL` (ο κώδικας δέχεται και `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `DATABASE_URL_UNPOOLED`). Μετά: Deployments → Redeploy.
2. **Supabase:** ο λογαριασμός έχει ήδη **2 ενεργά δωρεάν projects** (όριο), σε άλλους οργανισμούς. Ο νέος οργανισμός «Nido Vilage» (id `hmntmbxtdouembvebzfq`) υπάρχει χωρίς project. Για να δημιουργηθεί project εκεί πρέπει να παυθεί/διαγραφεί ένα από τα δύο παλιά. Σύνδεση: χρησιμοποίησε το **session pooler** URL (IPv4), π.χ. `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Για Supabase ο κώδικας βάζει αυτόματα TLS χωρίς επαλήθευση CA (`PG_SSL=no-verify`), αλλιώς `PG_SSL=require`.

### Μεταβλητές περιβάλλοντος στο Vercel (Production + Preview)
```
DATABASE_URL = <από Neon ή Supabase>
NIDO_SECRET = <τυχαίο μακρύ string>        # υπογραφή cookies + κρυπτογράφηση PIN
NIDO_MODE = store                           # «store»: πλήρες σύστημα. «cloud»: μόνο dashboard συνεταίρων + /api/sync
NIDO_SEED_DEMO = 1                          # φόρτωση demo δεδομένων σε άδεια βάση (0 για να μη φορτωθούν)
PARTNER_BOOTSTRAP_EMAIL = partner@nido.demo # προαιρετικό: πρώτος συνεταίρος (το seed φτιάχνει ήδη τον demo)
PARTNER_BOOTSTRAP_PASSWORD = nido-demo-2026
```
Προαιρετικά για την αρχιτεκτονική κατάστημα→cloud: `CLOUD_SYNC_URL`, `CLOUD_SYNC_KEY`, `CLOUD_SYNC_INTERVAL_SEC` (βλ. README).

### Περιορισμοί του Vercel demo (ακόμη και με βάση)
- Οι ζωντανές ενημερώσεις μεταξύ συσκευών (SSE) δεν δουλεύουν αξιόπιστα σε serverless: οι οθόνες ανανεώνονται με polling 30–60". Στο box του καταστήματος είναι ακαριαίες.
- Οι εκτυπώσεις στο cloud πάνε μόνο στην προεπισκόπηση (driver «console»). Πραγματικοί εκτυπωτές απαιτούν την εφαρμογή στο LAN του καταστήματος (Docker, βλ. README).
- Η τελική αρχιτεκτονική είναι: **box στο κατάστημα** (local-first, εκτυπωτές, PDA) + **cloud** (`NIDO_MODE=cloud`) για συνεταίρους. Το Vercel demo είναι για να το δει κανείς.

## 5. Τι ΔΕΝ κάνει ακόμη (νομικά σημαντικό)

- **Δεν εκδίδει νόμιμες αποδείξεις.** Στην εστίαση με σερβίρισμα απαιτείται ΦΗΜ εστιατορίου ή πιστοποιημένος **πάροχος ΥΠΑΗΕΣ** (Epsilon Net, SoftOne, Impact, Oxygen κ.ά.). Υπάρχει έτοιμη διεπαφή `src/server/fiscal/provider.ts` (Noop). Κάθε παραγγελία καταγράφεται ως «Δελτίο Παραγγελίας Εστίασης 8.6» και κάθε πληρωμή ως «απόδειξη 11.1» στον πίνακα `fiscal_documents` με status `not_required`, ώστε η σύνδεση παρόχου να είναι μόνο υλοποίηση της διεπαφής. Μέχρι τότε η απόδειξη βγαίνει από την υπάρχουσα ταμειακή και το σύστημα τρέχει παράλληλα. Λεπτομέρειες: `docs/ARCHITECTURE.md` §2.
- Δεν συνδέεται με τερματικά POS (Α.1155/2023), δεν στέλνει SMS, δεν δέχεται online πληρωμή στην παραγγελία QR (πληρωμή στο ταμείο), δεν έχει κρατήσεις τραπεζιών/γηπέδου, loyalty, efood/Wolt.

## 6. Δομή κώδικα (για να βρει γρήγορα ο επόμενος)

```
src/db/schema.ts, seed.ts, index.ts     σχήμα, demo δεδομένα, σύνδεση (PGlite/Postgres, migrations με retry)
drizzle/                                SQL migrations
src/server/services/                    catalog, floor, ordering, billing, inventory, reports, staff, printers,
                                        settings, partners, public-order (QR), events, assets
src/server/printing/                    ticket model, ESC/POS, drivers (tcp/console), templates, queue, logo bitmap
src/server/fiscal/provider.ts           διεπαφή παρόχου ΥΠΑΗΕΣ (Noop)
src/server/cloud/                       snapshot στατιστικών + publisher (store → cloud)
src/server/auth.ts, pin.ts, proxy.ts    PIN login, JWT cookies, έλεγχος πρόσβασης (δημόσια: /order, /pickup, /brand, /api/public, /api/assets)
src/app/                                οθόνες (login, pda, kds, cashier, order, pickup, admin/*, partners, api/*)
src/components/                         ui, shell (κεφαλίδα), brand (λογότυπο), live (SSE), floor-map, ops/*, admin/*, qr/*
src/instrumentation.ts                  εκκίνηση: migrations, seed (με advisory lock), print worker, cloud publisher
scripts/e2e-smoke.mjs                   end-to-end έλεγχος με Playwright
docs/ARCHITECTURE.md, README.md         αρχιτεκτονική, νομικό πλαίσιο, οδηγίες
```

## 7. Πώς να το επαληθεύσεις μετά το online στήσιμο

1. Άνοιξε `https://nido-village.vercel.app/api/health` → `{"ok":true}`.
2. `/login` → 1111 → άνοιξε τραπέζι από τον χάρτη → πρόσθεσε «Classic Burger» → «Αποστολή στην κουζίνα».
3. `/login` → 4444 → `/kds` → δες την παραγγελία → «ΕΤΟΙΜΟ».
4. `/login` → 2222 → `/cashier` → πληρωμή.
5. Από κινητό: `/order` → παραγγελία → `/pickup` σε άλλη καρτέλα → στο ταμείο «Έτοιμη» → το κινητό ειδοποιείται.
6. `/admin` → 1234 → Χάρτης, Αποθήκη (Βότκα: 3 μπουκάλια · 35 ποτά), Εκδηλώσεις, Αναφορές.

## 8. Προτεινόμενη πρώτη εντολή στη νέα συνομιλία

> «Έχω το repo alexkeramop-ctrl/Nido-Village (branch claude/wizardly-fermi-sscf43, commit ed1cf19) και το Vercel project nido-village. Διάβασε το docs/HANDOFF.md και βοήθησέ με να ολοκληρώσω το online στήσιμο: βάση δεδομένων (Neon μέσω Vercel ή Supabase), μεταβλητές περιβάλλοντος, απενεργοποίηση Vercel Authentication, redeploy και έλεγχος ότι όλα δουλεύουν. Μετά συνεχίζουμε με [επόμενο ζητούμενο].»

## 9. Ιστορικό αποφάσεων (σύντομα)

- Local-first αρχιτεκτονική: το κατάστημα δεν σταματά χωρίς internet· το cloud παίρνει μόνο στατιστικά.
- Χρήματα σε ακέραια λεπτά, ΦΠΑ ανά είδος (13%/24%/6%/0%), ο λογιστής επιβεβαιώνει την αντιστοίχιση.
- Διαγραφές με ιστορικό = αρχειοθέτηση (για να μη χαλάσουν οι αναφορές).
- «Πιάτα» (courses) ρυθμισμένα σε 1 (κρύβονται)· αλλάζει στις Ρυθμίσεις.
- Το αρχικό απόθεμα του demo καταγράφεται ως «χειροκίνητη» κίνηση ώστε η απόκλιση απογραφής να μετρά μόνο πραγματικές απογραφές.
