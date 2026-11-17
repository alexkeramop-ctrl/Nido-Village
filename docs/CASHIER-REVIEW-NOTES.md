# Ταμείο: ευρήματα ελέγχου χρημάτων (σε εκκρεμότητα)

Κατάσταση: η υλοποίηση ανέβηκε στο live (commit bc469d0). Οι διορθώσεις ήταν στη μέση όταν έγινε παύση (branch cashier-fixes-wip, μη επαληθευμένες).
Εκκρεμούν: ολοκλήρωση διορθώσεων, έλεγχος browser (tablet/κινητό), έλεγχος ασφάλειας παραγωγής.

## [major] Till: after the cart changes while the pay panel is open, "Ολοκλήρωση" is enabled but silently does nothing (money can be taken with no sale recorded or sent)

**Απόδειξη:** Cause: changeCart() does setPayRef(null) on every cart change, and confirmSale() starts with `if (submitting.current || !cart.length || !shift || !payRef) return;` with no message. The product grid stays tappable next to the pay panel on tablet/desktop.
Playwright against the production build (next start, isolated PGlite demo DB), 1280x800, cashier PIN 2222, Ταμείο 1: Νερό 1L -> "Πληρωμή 1,00 €" -> tap "Νερό 500ml" in the grid. Pay panel now shows "2 είδη · Σύνολο 1,50 €", button "Ολοκλήρωση" not disabled. Click: 0 POST requests, no toast, no "✓ Η πώληση ολοκληρώθηκε", panel unchanged; two more clicks, /api/till still salesCount 0, cash 0. Only "‹ Καλάθι" then "Πληρωμή 1,50 €" again completes the sale. Same result at 412x915 (pay view -> close sheet -> add product -> reopen sheet -> Ολοκλήρωση: 0 POSTs).
Scripts: /tmp/claude-0/-home-user/e53ae56c-5849-5a37-9e25-4ebff19696de/scratchpad/money-audit/s1.js and /tmp/claude-0/-home-user/e53ae56c-5849-5a37-9e25-4ebff19696de/scratchpad/money-audit/s1m.js

**Προτεινόμενη διόρθωση:** Never leave the pay view without a key: in changeCart use setPayRef(view === "pay" ? newClientRef() : null), or create the key lazily inside confirmSale (const ref = payRef ?? newClientRef()). Replace the silent return with a toast. Optionally disable the product grid while the pay panel is open.

## [major] Till: a discount stays active for the next customer when the cart is emptied line by line; the cart view shows the full price while the pay panel charges the discounted one

**Απόδειξη:** Cause: `discount` state is cleared only in clearSale() ("Άδειασμα" or a completed sale). removeLine()/changeCart() leave it set, and discountCents = min(discount.cents, subtotal) is re-applied to whatever is added next. The cart footer and the button show `subtotal` only.
Playwright, admin (PIN 1234) on Ταμείο 2: 2x Νερό 500ml -> Πληρωμή -> Έκπτωση 0,60 "Κέρασμα" (panel: Υποσύνολο 1,00 / Έκπτωση -0,60 / Σύνολο 0,40) -> "‹ Καλάθι" -> remove the line with ✕ (cart shows the empty message). Next customer: Τσάι 2,50 -> cart footer "Σύνολο · 1 είδος 2,50 €", button "Πληρωμή 2,50 €" -> pay panel "Υποσύνολο 2,50 € | Έκπτωση · Κέρασμα -0,60 € | Σύνολο 1,90 €" -> Κάρτα -> "✓ Η πώληση ολοκληρώθηκε · Σύνολο 1,90 €"; /api/till?register=2 card total +190 for an item priced 250. Because of the min() cap, a previous 100% treat would make a smaller next sale free. Only manager/admin sessions are affected (cashiers cannot discount).
Script: /tmp/claude-0/-home-user/e53ae56c-5849-5a37-9e25-4ebff19696de/scratchpad/money-audit/s8.js

**Προτεινόμενη διόρθωση:** Reset discount (and buzzer/name) whenever the cart becomes empty, e.g. in changeCart: if the next cart has no lines call clearSale(). Show the discount line and the discounted total in the cart view and on the "Πληρωμή" button so the two views always agree.

## [major] In polling mode (how production runs on Cloudflare Workers) an open till never reloads the catalog; after a price change every sale with that product is rejected with a generic total-mismatch error

**Απόδειξη:** Cause: the till's useLive handler calls router.refresh() only for e.type === "catalog.changed". On Workers /api/events answers sseUnsupported(), so the handler only ever receives {type:"poll"} and fetches /api/till, whose snapshot carries pending/ready/shift/unavailableIds but no prices or catalog version.
Playwright with /api/events fulfilled exactly as sseUnsupported() does: admin changed Νερό 1L from 1,00 to 1,50 in /admin/menu. 22 s later (more than one 15 s poll) the till still showed "Νερό 1L, 1,00 €"; pay panel total 1,00 €; Ολοκλήρωση -> toast "Τα ποσά της πληρωμής δεν συμφωνούν με το σύνολο", no sale. Control run with live events (local Node): the new price reached the till within 6 s and the sale completed. It fails closed (no wrong amount is charged), but the cashier quotes the old price and cannot sell the item, with no hint that a reload is needed.
Scripts: /tmp/claude-0/-home-user/e53ae56c-5849-5a37-9e25-4ebff19696de/scratchpad/money-audit/s6.js and /tmp/claude-0/-home-user/e53ae56c-5849-5a37-9e25-4ebff19696de/scratchpad/money-audit/s6b.js

**Προτεινόμενη διόρθωση:** Add a catalog version (e.g. max updatedAt or a hash of product/modifier prices and active flags) to tillSnapshot and call router.refresh() when it changes. On a total mismatch return a specific message ("Άλλαξαν τιμές, το μενού ανανεώθηκε") and reprice the cart lines from the fresh menu instead of the generic tender error.

## [minor] Retry after a lost response ignores a changed tender: the sale stays recorded as cash while the screen reports success after the cashier switched to card

**Απόδειξη:** Cause: saleByClientRef() returns the stored sale for a known clientRef without comparing it to the request, and till-screen.tsx keeps payRef when only the tender changes and treats duplicate:true as a normal success.
Playwright: 3x Νερό 1L (3,00 €), cash, given 20 €; the response was dropped after the server processed it (route.fetch() then abort). Toast: "Δεν ολοκληρώθηκε (πρόβλημα σύνδεσης). Πάτησε ξανά «Ολοκλήρωση»"; /api/till already showed the sale (cash 350 -> 650). Switched to "Κάρτα" and pressed again -> "✓ Η πώληση ολοκληρώθηκε · Σύνολο 3,00 € · Ρέστα 17,00 €"; shift: cash 650, card 0, expectedCash 5650. If the customer really paid by card, expected cash is 3,00 € too high (false shortage at close) and card is understated.
Temporary vitest probe (removed): quickSale with the same clientRef and tender {cardCents:500}, and again with a different cart on another shift, both returned duplicate:true with payments [{cash,500}] and one session in the DB.
Script: /tmp/claude-0/-home-user/e53ae56c-5849-5a37-9e25-4ebff19696de/scratchpad/money-audit/s2.js

**Προτεινόμενη διόρθωση:** On a duplicate, compare the stored payments/total with the incoming tender/cart. If they differ, return an explicit result the UI must show ("Η πώληση είχε ήδη καταχωρηθεί ως ΜΕΤΡΗΤΑ 3,00 €") instead of a plain success, or lock the tender controls after a connection error so only the identical retry is possible.

## [minor] Day summary per register books a whole shift on the day it opened: a shift left open past midnight appears on two dates, and after it closes the later day's sales are missing from that day

**Απόδειξη:** Temporary vitest probe (removed): shift opened yesterday 20:00 Athens on Ταμείο 1, one 10,00 € cash sale dated yesterday, one 5,00 € cash sale today on the same shift.
While open: daySummary(today).grandTotalCents rose by 1500 and daySummary(yesterday).grandTotalCents = 1500, while financeMonth income for today rose by 500. The same 15,00 € is shown on both dates.
After closing it today: daySummary(today) rose by 0 (today's 5,00 € is not on today's page), daySummary(yesterday) = 1500.
This contradicts the comment on DaySummary.grandTotalCents ("συμφωνεί με τα έσοδα ταμείου της ημέρας στα Έσοδα – Έξοδα"); the existing test only covers shifts opened and used the same day. Related: the till header prints only "βάρδια από HH:MM" (fmtTime), so a cashier continuing yesterday's unclosed shift gets no sign of it.

**Προτεινόμενη διόρθωση:** Decide the rule and make the page say it. Either sum each shift's payments by payments.createdAt inside the selected day (so the page equals the day's takings and matches finance), or keep business-day attribution but label it, and exclude or separately total carried-over shifts. Show the date and a warning in the till when the open shift started on a previous day.

## Επαληθευμένα
- Full vitest suite green before and after the audit: 24 files, 90 tests. Temporary probe tests (tests/zz-audit-money-a.test.ts, tests/zz-audit-money-b.test.ts) were removed; no source file was modified; nothing committed or pushed.
- UI checks ran on the existing production build (.next, built 11:40) with an isolated PGlite demo DB on port 3017, now stopped. Only src/app/cashier/actions.ts is newer than that build (11:42); the client files where the findings live are older than the build and were also read in the current tree.
- Double submit: 6 synchronous clicks on "Ολοκλήρωση" produced one sale (salesCount 1 -> 2, cash +200). Existing tests cover a sequential and a concurrent repeat of the same clientRef.
- Sale racing with close of the same shift (service, Promise.allSettled): the close won, the sale was rejected with "Η βάρδια του ταμείου έχει κλείσει", stored expectedCashCents equals the recomputed summary.
- Shift closed from a second device while the first had a sale in the pay panel (UI): sale rejected with a clear message, nothing recorded, the first device shows "Η βάρδια του «Ταμείο 1» έκλεισε" after its poll. Close report: float 50,00 + cash 6,50 = expected 56,50, counted 56,50, difference 0.
- QR order paid once only: three concurrent attempts at service level (payOrderAtTill on shift 1, on shift 2, legacy addPayment) gave one success and two clean rejections, payments sum 850. In the UI two tills pressed together: one payment (card 250 on Ταμείο 2), nothing on Ταμείο 1, pending list empty on both, public status page shows "Βομβητής 42 · Πληρώθηκε".
- Split payment and change through the UI: 3,00 € = 2,00 card + 1,00 cash, given 5 € -> change 4,00; shift cash +100, card +200, expected cash +100, sales +1.
- Totals: discount larger than the remaining due on a partly paid account is rejected ("Οι πληρωμές υπερβαίνουν το σύνολο"); VAT gross per rate sums to the total after discount (792 + 208 = 1000); a cashier can pay a QR order already discounted by a manager only with the exact discounted amount (700, change 1300 on 2000).
- Reports and finance: after a mixed day (quick sales with split and 100% discount, QR at till, partly paid table finished at another till) shift totals + payments without a shift = financeMonth POS total = salesSummary gross (3067), byMethod identical in both.
- Stock: one quick sale with the same product on three lines (two with a modifier) moved beef -6 and cheddar -5, one movement set per order item; a repeated clientRef returns before any write.
- Attribution: quick sale and QR payment are written to the shift id sent by the screen, which is refreshed from /api/till for the register shown in the header; the legacy partial-payment screen uses the device cookie's register. The server does not check that the shift belongs to the device's register (only reachable with a crafted request).
- Not reproduced: a waiter round sent at the same moment the till pays the same table. On PGlite whichever call ran first won and the other failed with "Η συνεδρία έχει κλείσει" in all three orderings tried; real Postgres concurrency was not tested.
- Not tested: anything against Cloudflare/Neon (by instruction); node-postgres row-lock behaviour was reviewed by reading only.