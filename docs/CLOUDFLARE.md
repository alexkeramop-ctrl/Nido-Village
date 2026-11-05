# Nido Village PDA στο Cloudflare Workers (pda.nidovillage.gr)

Build με OpenNext (`@opennextjs/cloudflare`). Η βάση είναι η Supabase «Nido Vilage» μέσω **Hyperdrive**.

## Τι αλλάζει σε σχέση με το box του καταστήματος
- Βάση: πάντα Postgres (Hyperdrive ή `DATABASE_URL`). Χωρίς PGlite. Τα migrations είναι ενσωματωμένα
  (`src/db/migrations.generated.ts`, από `scripts/embed-migrations.mjs`) και τρέχουν στο πρώτο αίτημα, μαζί με το demo seed.
- Ζωντανές ενημερώσεις: οι οθόνες ανανεώνονται κάθε ~10″ (τα Workers δεν κρατούν ανοιχτές συνδέσεις SSE).
- Εκτυπώσεις: η ουρά αδειάζει μετά από κάθε αίτημα. Μόνο driver «console» (προεπισκόπηση). Πραγματικοί εκτυπωτές θέλουν το box στο LAN.
- Χωρίς εργασίες παρασκηνίου (print worker, cloud publisher).

## Στήσιμο (μία φορά)
1. **Supabase → Project «Nido Vilage» → Connect**: αντιγράψτε το *Session pooler* connection string (με τον κωδικό της βάσης).
2. **Cloudflare → Storage & databases → Hyperdrive → Create configuration**: όνομα `nido-pda-db`, επικολλήστε το connection string. Αντιγράψτε το **ID**.
3. Στο `wrangler.jsonc` ενεργοποιήστε τη γραμμή `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<ID>" }]`.
4. **Cloudflare → Workers & Pages → Create → Import a repository** → `alexkeramop-ctrl/Nido-Village`, branch `cloudflare`:
   - Build command: `npm run build:cf`
   - Deploy command: `npx opennextjs-cloudflare deploy`
5. Worker `nido-pda` → **Settings → Variables and Secrets** → Add → Type *Secret*: `NIDO_SECRET` = μεγάλο τυχαίο κείμενο.
   (Μην το αλλάξετε αργότερα: χαλάνε τα PIN και οι συνδέσεις.)
   Επίσης Secret `NIDO_ADMIN_PIN` = το PIN του διαχειριστή (4–8 ψηφία). Τότε τα γνωστά demo PIN (1234, 1111, …) δεν
   δουλεύουν: οι υπόλοιποι demo υπάλληλοι παίρνουν τυχαία PIN (φαίνονται στο /admin/staff) και δεν φτιάχνεται demo συνεταίρος.
6. Re-deploy. Το `pda.nidovillage.gr` (route `custom_domain` στο wrangler.jsonc) στήνεται αυτόματα.
7. Έλεγχος: `https://pda.nidovillage.gr/api/health` → `{"ok":true}`.

## Αμέσως μετά το πρώτο άνοιγμα
Μπείτε με το `NIDO_ADMIN_PIN` → `/admin/staff`: μετονομάστε/διαγράψτε τους demo υπαλλήλους και βάλτε τους πραγματικούς.
Χωρίς `NIDO_ADMIN_PIN` φορτώνονται τα δημόσια γνωστά demo PIN (1234 κ.λπ.) — αλλάξτε τα αμέσως.

## Πλάνο Cloudflare
Το worker είναι ~2,8 MB (όριο Free: 3 MB). Το Free plan έχει όριο 10 ms CPU ανά αίτημα, που η σελίδα (Next.js) και ο
έλεγχος PIN (scrypt) ξεπερνούν εύκολα → προτείνεται **Workers Paid ($5/μήνα)**.

## Τοπική δοκιμή όπως στο Cloudflare
`.dev.vars`: `DATABASE_URL=postgres://…`, `PG_SSL=off`, `NIDO_SECRET=…` → `npm run preview:cf` (ή `npm run build:cf && npx wrangler dev`).
