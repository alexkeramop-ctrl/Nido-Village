"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Money, useToast } from "@/components/ui";
import { useLive } from "@/components/live";
import { DiscountModal } from "@/components/ops/discount-modal";
import { ProductModal, type MenuProduct } from "@/components/ops/product-modal";
import { addLine, cartCount, cartTotal, lineTotal, repriceCart, toCartLines, type UiLine } from "@/components/ops/cart";
import { PAYMENT_METHOD_LABEL, fmtDateTime, fmtTime } from "@/components/ops/labels";
import { formatEuro } from "@/server/money";
import type { TenderInput } from "@/lib/tender";
import type { Menu } from "@/server/services/catalog";
import type { ShiftDto } from "@/server/services/registers";
import type { QuickSaleInput, SaleResult, TillSnapshot } from "@/server/services/till";
import { quickSaleAction, selectRegisterAction } from "./actions";
import { OrdersSheet } from "./pending-list";
import { PayPanel } from "./pay-panel";
import { CloseShiftModal, ShiftReport } from "./shift-panels";

const TOP = "top" as const;
const FREQUENT_COUNT = 12;

/** Κλειδί πώλησης για τη συσκευή (το crypto.randomUUID υπάρχει μόνο σε https/localhost). */
function newClientRef(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(12);
  c?.getRandomValues?.(bytes);
  return `${Date.now().toString(36)}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ενημέρωση των συνόλων της βάρδιας από το αποτέλεσμα της πώλησης, χωρίς να ρωτηθεί ο server. */
function withSale(shift: ShiftDto, sale: SaleResult): ShiftDto {
  if (sale.duplicate || !sale.payments.length) return shift;
  const byMethod = { cash: { ...shift.byMethod.cash }, card: { ...shift.byMethod.card }, other: { ...shift.byMethod.other } };
  let cash = 0;
  for (const p of sale.payments) {
    byMethod[p.method].totalCents += p.amountCents;
    byMethod[p.method].count += 1;
    if (p.method === "cash") cash += p.amountCents;
  }
  return { ...shift, byMethod, salesCount: shift.salesCount + 1, totalCents: shift.totalCents + sale.totalCents, expectedCashCents: shift.expectedCashCents + cash };
}

type Shown = { product: MenuProduct; color: string };

const RETRY_FIRST = "Πάτησε πρώτα «Επανάληψη»: η προηγούμενη πώληση περιμένει απάντηση.";

/** «Μετρητά 3,00 € + Κάρτα 2,00 €» από τις πληρωμές μιας πώλησης. */
function paymentsLabel(payments: SaleResult["payments"]): string {
  return payments.length ? payments.map((p) => `${PAYMENT_METHOD_LABEL[p.method]} ${formatEuro(p.amountCents)}`).join(" + ") : "χωρίς χρέωση";
}

/** Τι άλλαξε στο καλάθι όταν ήρθε νέος κατάλογος (για την ειδοποίηση προς τον ταμία). */
function menuChangeNotice(repriced: string[], removed: string[]): string {
  const parts: string[] = [];
  if (repriced.length) parts.push(`${repriced.length === 1 ? "Άλλαξε η τιμή" : "Άλλαξαν οι τιμές"}: ${repriced.join(", ")}.`);
  if (removed.length) parts.push(`${removed.length === 1 ? "Δεν πωλείται πια και βγήκε" : "Δεν πωλούνται πια και βγήκαν"} από το καλάθι: ${removed.join(", ")}.`);
  return `${parts.join(" ")} Το καλάθι ενημερώθηκε· έλεγξε το σύνολο.`;
}

/**
 * Το ταμείο self-service: μία οθόνη, χωρίς αλλαγή σελίδας ανά πώληση.
 * Αριστερά οι κατηγορίες, στη μέση τα είδη, δεξιά το καλάθι και η πληρωμή. Ο κατάλογος φορτώνεται μία φορά με τη σελίδα·
 * το πάτημα ενός είδους αλλάζει μόνο τοπική κατάσταση. Ο server καλείται ΜΙΑ φορά ανά πώληση.
 */
export function TillScreen({
  register,
  userName,
  canDiscount,
  menu,
  catalogVersion,
  frequentIds,
  initial,
}: {
  register: { id: number; name: string };
  userName: string;
  canDiscount: boolean;
  menu: Menu;
  /** Το αποτύπωμα του καταλόγου με τον οποίο φορτώθηκε το `menu`. Όταν ο server αναφέρει άλλο, η σελίδα ξαναφορτώνει το μενού. */
  catalogVersion: string;
  frequentIds: number[];
  initial: TillSnapshot;
}) {
  const router = useRouter();
  const { toast, element } = useToast();
  const [, startTransition] = useTransition();
  const [snap, setSnap] = useState<TillSnapshot>(initial);
  const [cart, setCart] = useState<UiLine[]>([]);
  const [catId, setCatId] = useState<number | typeof TOP>(TOP);
  const [buzzer, setBuzzer] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [discount, setDiscount] = useState<{ cents: number; reason: string } | null>(null);
  const [view, setView] = useState<"cart" | "pay">("cart");
  const [payByKeyboard, setPayByKeyboard] = useState(false);
  const [pending, setPending] = useState(false);
  /** Πώληση που στάλθηκε αλλά δεν ήρθε απάντηση (άγνωστο αν γράφτηκε). Όσο υπάρχει, επιτρέπεται ΜΟΝΟ η αυτούσια επανάληψή της. */
  const [unsent, setUnsent] = useState<QuickSaleInput | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  const [pricedWith, setPricedWith] = useState(menu);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);
  const [configProduct, setConfigProduct] = useState<MenuProduct | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [closed, setClosed] = useState<ShiftDto | null>(null);
  const submitting = useRef(false);
  /** Κλειδί της τρέχουσας πώλησης (δημιουργείται στο πρώτο «Ολοκλήρωση», σβήνει σε κάθε αλλαγή της πώλησης). */
  const payRef = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ----------------------- ανανέωση στο παρασκήνιο ----------------------- */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/till?register=${register.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as TillSnapshot;
      setSnap(next);
      // Άλλαξε ο κατάλογος (τιμή, είδος, επιλογή): ξαναφορτώνεται το μενού. Είναι ο ΜΟΝΟΣ δρόμος στο Cloudflare,
      // όπου δεν υπάρχουν ζωντανά events και το ταμείο μαθαίνει τα νέα μόνο από αυτή την ανανέωση.
      if (next.catalogVersion && next.catalogVersion !== catalogVersion) startTransition(() => router.refresh());
    } catch {
      /* εκτός σύνδεσης: κρατάμε ό,τι έχουμε */
    }
  }, [register.id, catalogVersion, router]);
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 200);
  }, [refresh]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );
  useLive(["session.changed", "kds.changed", "catalog.changed"], refreshSoon, { pollMs: 15000 });

  // Νέος κατάλογος από τον server: το καλάθι παίρνει αμέσως τις τρέχουσες τιμές, ώστε αυτό που βλέπει ο ταμίας
  // να είναι αυτό που θα χρεώσει ο server (αλλιώς κάθε πώληση με το είδος θα απορριπτόταν).
  if (pricedWith !== menu) {
    setPricedWith(menu);
    const products = menu.flatMap((c) => c.products);
    const r = repriceCart(cart, products);
    if (r.lines.length !== cart.length || r.lines.some((l, i) => l !== cart[i])) setCart(r.lines);
    if (r.repriced.length || r.removed.length) setMenuNotice(menuChangeNotice(r.repriced, r.removed));
    if (configProduct) setConfigProduct(products.find((p) => p.id === configProduct.id) ?? null);
  }

  /* ------------------------------ κατάλογος ------------------------------ */
  const unavailable = useMemo(() => new Set(snap.unavailableIds), [snap.unavailableIds]);
  const frequent = useMemo<Shown[]>(() => {
    const all = menu.flatMap((c) => c.products.map((product) => ({ product, color: c.color })));
    const byId = new Map(all.map((x) => [x.product.id, x]));
    const out: Shown[] = [];
    for (const id of frequentIds) {
      const x = byId.get(id);
      if (x && !out.includes(x)) out.push(x);
    }
    // Χωρίς ιστορικό πωλήσεων (ή με λίγο): συμπληρώνεται με τα πρώτα είδη του μενού.
    for (const x of all) {
      if (out.length >= FREQUENT_COUNT) break;
      if (!out.includes(x)) out.push(x);
    }
    return out.slice(0, FREQUENT_COUNT);
  }, [menu, frequentIds]);
  const category = catId === TOP ? null : (menu.find((c) => c.id === catId) ?? null);
  const shown: Shown[] = category ? category.products.map((product) => ({ product, color: category.color })) : frequent;
  const qtyByProduct = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of cart) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
    return m;
  }, [cart]);

  /* ------------------------------- καλάθι ------------------------------- */
  const count = cartCount(cart);
  const subtotal = cartTotal(cart);
  const discountCents = discount ? Math.min(discount.cents, subtotal) : 0;
  const total = subtotal - discountCents;
  const retryOnly = unsent !== null;
  // Η έκπτωση ανήκει στην πώληση που έχει είδη: άδειο καλάθι (π.χ. αφαίρεση γραμμών μία-μία) τη σβήνει,
  // ώστε να μην «κληρονομηθεί» κρυφά από τον επόμενο πελάτη.
  if (discount && cart.length === 0) setDiscount(null);

  /** Κάθε αλλαγή στην πώληση ακυρώνει το κλειδί της: νέο περιεχόμενο = νέα πώληση. */
  const changeCart = (fn: (prev: UiLine[]) => UiLine[]) => {
    if (retryOnly) return toast(RETRY_FIRST, "danger");
    setCart(fn);
    payRef.current = null;
  };
  const tapProduct = (p: MenuProduct) => {
    if (unavailable.has(p.id)) return;
    if (retryOnly) return toast(RETRY_FIRST, "danger");
    setLastSale(null);
    if (p.modifierGroups.length) setConfigProduct(p);
    else changeCart((prev) => addLine(prev, { productId: p.id, name: p.name, unitPriceCents: p.priceCents, qty: 1, course: 1, notes: "", modifiers: [] }));
  };
  const changeQty = (key: string, delta: number) => changeCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.min(99, Math.max(1, l.qty + delta)) } : l)));
  const removeLine = (key: string) => changeCart((prev) => prev.filter((l) => l.key !== key));
  const setNote = (key: string, notes: string) => changeCart((prev) => prev.map((l) => (l.key === key ? { ...l, notes: notes.slice(0, 120) } : l)));
  const removeDiscount = () => {
    setDiscount(null);
    payRef.current = null;
  };
  const clearSale = () => {
    setCart([]);
    setBuzzer("");
    setCustomerName("");
    setDiscount(null);
    setMenuNotice(null);
    payRef.current = null;
    setNoteKey(null);
    setView("cart");
  };

  const goPay = (byKeyboard = false) => {
    if (!cart.length) return;
    if (buzzer && (Number(buzzer) < 1 || Number(buzzer) > 999)) return toast("Ο βομβητής πρέπει να είναι από 1 έως 999", "danger");
    setPayByKeyboard(byKeyboard);
    setNoteKey(null);
    setView("pay");
    setSheetOpen(true);
  };

  /**
   * ΜΙΑ κλήση στον server ανά πώληση. Το ref μπλοκάρει το διπλό πάτημα· το clientRef κάνει την επανάληψη ακίνδυνη.
   * Το κουμπί δεν μένει ποτέ «βουβό»: ή στέλνει την πώληση ή λέει γιατί όχι.
   * Χωρίς όρισμα = επανάληψη της πώλησης που έμεινε χωρίς απάντηση (αυτούσιο το ίδιο αίτημα: ίδιο κλειδί, ίδια πληρωμή).
   */
  const confirmSale = async (tender?: TenderInput) => {
    if (submitting.current) return;
    let payload = unsent;
    if (!payload) {
      const shift = snap.shift;
      if (!shift) return toast("Η βάρδια του ταμείου έκλεισε. Άνοιξε βάρδια για να συνεχίσεις.", "danger");
      if (!cart.length || !tender) {
        setView("cart");
        return toast("Το καλάθι είναι άδειο", "danger");
      }
      payload = {
        cashSessionId: shift.id,
        clientRef: (payRef.current ??= newClientRef()),
        buzzerNo: buzzer ? Number(buzzer) : null,
        customerName: customerName.trim() || null,
        lines: toCartLines(cart),
        discount: discountCents > 0 && discount ? { cents: discountCents, reason: discount.reason } : null,
        tender,
        expectedTotalCents: total,
      };
    }
    submitting.current = true;
    setPending(true);
    try {
      const r = await quickSaleAction(payload);
      setUnsent(null);
      if (!r.ok) {
        toast(r.error, "danger");
        // Ο server απέρριψε την πώληση: κάτι που δείχνει το ταμείο είναι παλιό (τιμή, εξαντλημένο είδος, βάρδια). Φρέσκα δεδομένα.
        startTransition(() => router.refresh());
        refreshSoon();
        return;
      }
      setLastSale(r.data);
      setSnap((s) => (s.shift ? { ...s, shift: withSale(s.shift, r.data) } : s));
      clearSale();
      refreshSoon();
    } catch {
      // Άγνωστο αν γράφτηκε: κλειδώνει η πώληση ώστε να μπορεί μόνο να ξανασταλεί ίδια (όχι άλλη πληρωμή, όχι άλλο καλάθι).
      setUnsent(payload);
      setView("pay");
      toast("Δεν ήρθε απάντηση (πρόβλημα σύνδεσης). Πάτησε «Επανάληψη»: δεν θα χρεωθεί δεύτερη φορά.", "danger");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const switchRegister = () => {
    if (cart.length || retryOnly) return toast("Ολοκλήρωσε ή άδειασε πρώτα την πώληση", "danger");
    startTransition(async () => {
      const r = await selectRegisterAction(null);
      if (!r.ok) toast(r.error, "danger");
    });
  };

  if (closed) return <ShiftReport shift={closed} />;

  const shift = snap.shift;
  if (!shift) {
    return (
      <main className="flex-1 w-full max-w-md mx-auto p-4">
        <div className="card p-6 text-center space-y-3">
          <h1 className="text-xl font-bold">Η βάρδια του «{register.name}» έκλεισε</h1>
          <p className="text-sm text-ink-2">Έκλεισε από άλλη συσκευή. Άνοιξε νέα βάρδια για να συνεχίσεις.</p>
          <button type="button" className="btn-primary w-full" onClick={() => startTransition(() => router.refresh())}>
            Συνέχεια
          </button>
        </div>
      </main>
    );
  }

  const pendingCount = snap.pending.length;
  const readyCount = snap.ready.length;

  return (
    <div className="flex-1 flex flex-col min-h-0 lg:flex-none lg:h-[calc(100dvh-49px)] lg:overflow-hidden">
      {/* Γραμμή ταμείου */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 border-b border-line bg-white/50 backdrop-blur-xl">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-lg font-black tracking-tight whitespace-nowrap">{register.name}</span>
          <span className="text-xs text-ink-3 truncate">
            {userName} · βάρδια από <span className="num">{snap.shiftFromEarlierDay ? fmtDateTime(shift.openedAt) : fmtTime(shift.openedAt)}</span> · <span className="num">{shift.salesCount}</span> πωλήσεις
          </span>
        </div>
        {snap.shiftFromEarlierDay && (
          <span role="status" className="chip bg-warn-soft text-warn font-semibold" data-testid="shift-earlier-day">
            Βάρδια από προηγούμενη ημέρα · κλείσε το ταμείο
          </span>
        )}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          <button type="button" className={`btn btn-sm border ${pendingCount ? "bg-warn-soft text-warn border-warn/40" : "bg-white/70 text-ink border-line"}`} onClick={() => setOrdersOpen(true)}>
            Προς πληρωμή ({pendingCount})
          </button>
          {readyCount > 0 && (
            <button type="button" className="btn btn-sm border bg-ok-soft text-ok border-ok/40" onClick={() => setOrdersOpen(true)}>
              Έτοιμες ({readyCount})
            </button>
          )}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              void refresh();
              setCloseOpen(true);
            }}
          >
            Κλείσιμο ταμείου
          </button>
          <button type="button" className="btn-ghost btn-sm px-2" onClick={switchRegister} aria-label="Αλλαγή ταμείου" title="Αλλαγή ταμείου">
            ⇄
          </button>
        </div>
      </div>

      {/* Η γραμμή του πλέγματος έχει σταθερό ύψος (minmax(0,1fr)) ώστε κάθε στήλη να κυλά μόνη της και το «Ολοκλήρωση» να μένει ορατό. */}
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
        {/* Κατηγορίες: κάθετη στήλη (tablet/υπολογιστής) ή οριζόντια γραμμή (κινητό) */}
        <nav
          aria-label="Κατηγορίες"
          className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto p-2 border-b lg:border-b-0 lg:border-r border-line bg-white/40 sticky top-12 lg:static z-20 backdrop-blur-xl touch"
        >
          <CategoryButton label="Συχνά" color="#b08a3e" active={catId === TOP} onClick={() => setCatId(TOP)} />
          {menu.map((c) => (
            <CategoryButton key={c.id} label={c.name} color={c.color} active={catId === c.id} onClick={() => setCatId(c.id)} />
          ))}
        </nav>

        {/* Είδη */}
        <section aria-label="Είδη" className="min-w-0 lg:overflow-y-auto p-2 sm:p-3 pb-24 lg:pb-3">
          {shown.length === 0 ? (
            <p className="text-sm text-ink-3 p-6 text-center">{menu.length === 0 ? "Το μενού είναι κενό. Πρόσθεσε είδη από τη Διαχείριση → Μενού." : "Η κατηγορία δεν έχει είδη."}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
              {shown.map(({ product: p, color }) => {
                const off = unavailable.has(p.id);
                const inCart = qtyByProduct.get(p.id) ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={off}
                    onClick={() => tapProduct(p)}
                    aria-label={`${p.name}, ${formatEuro(p.priceCents)}${off ? ", εξαντλήθηκε" : ""}`}
                    className="card relative p-3 min-h-20 text-left flex flex-col touch transition active:scale-[0.97] border-l-4 disabled:opacity-50 disabled:bg-surface-3 hover:bg-white/80"
                    style={{ borderLeftColor: color }}
                  >
                    <span className="font-semibold leading-snug pr-6">{p.name}</span>
                    <span className="mt-auto pt-1.5 flex items-center justify-between gap-1 text-sm">
                      {off ? <span className="chip bg-danger-soft text-danger">εξαντλήθηκε</span> : <Money cents={p.priceCents} className="text-ink-2" />}
                      {p.modifierGroups.length > 0 && !off && <span className="text-xs text-ink-3">επιλογές ›</span>}
                    </span>
                    {inCart > 0 && (
                      <span aria-hidden className="absolute top-2 right-2 min-w-6 h-6 px-1.5 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center num">
                        {inCart}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Καλάθι / πληρωμή: στήλη δεξιά (lg) ή συρόμενο φύλλο από κάτω (κινητό) */}
        {sheetOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => !pending && setSheetOpen(false)} aria-hidden />}
        <aside
          aria-label="Καλάθι"
          className={`fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] rounded-t-2xl bg-[#f7f7f2] shadow-[0_-20px_60px_rgba(31,42,34,0.3)] flex flex-col transition-transform duration-200 ${
            sheetOpen ? "translate-y-0" : "translate-y-full invisible"
          } lg:static lg:z-auto lg:max-h-none lg:min-h-0 lg:translate-y-0 lg:visible lg:rounded-none lg:border-l lg:border-line lg:shadow-none lg:bg-white/45`}
        >
          <div className="lg:hidden flex items-center justify-between px-4 py-2 border-b border-line">
            <span className="font-semibold">{view === "pay" ? "Πληρωμή" : "Καλάθι"}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSheetOpen(false)} disabled={pending} aria-label="Κλείσιμο καλαθιού">
              ✕
            </button>
          </div>

          {menuNotice && (
            <div role="alert" className="mx-3 mt-3 rounded-xl bg-warn-soft text-warn px-3 py-2 text-sm flex items-start gap-2" data-testid="menu-notice">
              <span className="flex-1 min-w-0">{menuNotice}</span>
              <button type="button" className="btn-ghost btn-sm px-2! py-0.5! text-warn!" onClick={() => setMenuNotice(null)} aria-label="Κλείσιμο ειδοποίησης">
                ΟΚ
              </button>
            </div>
          )}

          {unsent ? (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-3" role="alert" data-testid="retry-sale">
              <h2 className="font-bold text-lg text-danger">Δεν ήρθε απάντηση</h2>
              <p className="text-sm text-ink-2">
                Η πώληση στάλθηκε αλλά η σύνδεση κόπηκε πριν απαντήσει ο server. <span className="font-semibold text-ink">Μπορεί να έχει ήδη καταχωρηθεί.</span>
              </p>
              <dl className="rounded-xl bg-surface-3 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Σύνολο</dt>
                  <dd className="num font-bold">{formatEuro(unsent.expectedTotalCents ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">Πληρωμή</dt>
                  <dd className="num font-semibold text-right">
                    {paymentsLabel([
                      ...(unsent.tender.cardCents > 0 ? [{ method: "card" as const, amountCents: unsent.tender.cardCents }] : []),
                      ...(unsent.tender.cashCents > 0 ? [{ method: "cash" as const, amountCents: unsent.tender.cashCents }] : []),
                    ])}
                  </dd>
                </div>
                {unsent.buzzerNo ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-2">Βομβητής</dt>
                    <dd className="num font-bold">{unsent.buzzerNo}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="text-sm text-ink-2">
                Πάτησε «Επανάληψη»: στέλνεται η <span className="font-semibold text-ink">ίδια ακριβώς</span> πώληση και δεν χρεώνεται δεύτερη φορά. Μην τη χτυπήσεις ξανά από την αρχή και μην ανανεώσεις τη σελίδα.
              </p>
              <button type="button" className="btn-primary w-full btn-lg mt-auto" disabled={pending} onClick={() => confirmSale()}>
                {pending ? "Αποστολή…" : "Επανάληψη"}
              </button>
              <p className="text-xs text-ink-3">Αν δεν περνά, έλεγξε το Wi‑Fi του ταμείου και ξαναπάτησε.</p>
            </div>
          ) : view === "pay" ? (
            <div className="flex-1 min-h-0 flex flex-col p-3">
              <PayPanel totalCents={total} pending={pending} onConfirm={confirmSale} onBack={() => setView("cart")} autoFocusAmount={payByKeyboard}>
                <div className="text-sm space-y-1">
                  <div className="text-ink-2">
                    <span className="num">{count}</span> {count === 1 ? "είδος" : "είδη"}
                    {buzzer ? (
                      <>
                        {" "}
                        · <span className="font-bold text-ink">Βομβητής {buzzer}</span>
                      </>
                    ) : (
                      " · χωρίς βομβητή"
                    )}
                    {customerName.trim() ? ` · ${customerName.trim()}` : ""}
                  </div>
                  {discountCents > 0 && (
                    <>
                      <div className="flex justify-between text-ink-2">
                        <span>Υποσύνολο</span>
                        <Money cents={subtotal} />
                      </div>
                      <div className="flex justify-between text-warn">
                        <span>Έκπτωση · {discount?.reason}</span>
                        <Money cents={-discountCents} />
                      </div>
                    </>
                  )}
                  {canDiscount && (
                    <button type="button" className="btn-secondary btn-sm w-full" disabled={pending} onClick={() => setDiscountOpen(true)}>
                      {discountCents > 0 ? "Αλλαγή έκπτωσης" : "Έκπτωση"}
                    </button>
                  )}
                </div>
              </PayPanel>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 p-3 border-b border-line">
                <div>
                  <label className="label" htmlFor="till-buzzer">
                    Βομβητής
                  </label>
                  <input
                    id="till-buzzer"
                    className="input num text-2xl! font-black text-center px-1! py-1.5! border-amber-500/70! bg-amber-50!"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={3}
                    placeholder="—"
                    value={buzzer}
                    onChange={(e) => {
                      setBuzzer(e.target.value.replace(/\D/g, "").slice(0, 3));
                      payRef.current = null;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") goPay(true);
                    }}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="till-name">
                    Όνομα <span className="text-ink-3 font-normal">(προαιρετικό)</span>
                  </label>
                  <input
                    id="till-name"
                    className="input h-[calc(100%-1.5rem)]"
                    autoComplete="off"
                    maxLength={40}
                    placeholder="π.χ. Κώστας"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      payRef.current = null;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") goPay(true);
                    }}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3">
                {cart.length === 0 ? (
                  lastSale ? (
                    <div
                      role={lastSale.differs ? "alert" : "status"}
                      aria-live={lastSale.differs ? "assertive" : "polite"}
                      className={`my-3 rounded-2xl p-4 text-center ${lastSale.differs ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}
                      data-testid="last-sale"
                    >
                      {lastSale.differs ? (
                        <>
                          {/* Η επανάληψη ζητούσε κάτι άλλο από αυτό που είχε ήδη γραφτεί: ΔΕΝ είναι απλή επιτυχία. */}
                          <div className="font-bold">Προσοχή: η πώληση είχε ήδη καταχωρηθεί · {lastSale.displayNo}</div>
                          <div className="text-sm mt-1 text-ink">
                            Γράφτηκε στην πρώτη προσπάθεια ως <span className="font-bold">{paymentsLabel(lastSale.payments)}</span>. Η αλλαγή που έγινε μετά ΔΕΝ ίσχυσε και δεν χρεώθηκε δεύτερη φορά.
                          </div>
                          <div className="text-sm mt-1 text-ink-2">Αν ο πελάτης πλήρωσε αλλιώς, ενημέρωσε τον υπεύθυνο και γράψ’ το στις σημειώσεις στο κλείσιμο ταμείου.</div>
                        </>
                      ) : (
                        <div className="text-sm font-semibold">✓ Η πώληση ολοκληρώθηκε · {lastSale.displayNo}</div>
                      )}
                      <div className="text-sm mt-0.5">
                        Σύνολο <span className="num font-semibold">{formatEuro(lastSale.totalCents)}</span>
                      </div>
                      {lastSale.changeCents > 0 ? (
                        <>
                          <div className="text-sm font-medium mt-2">Ρέστα</div>
                          <div className="text-4xl font-black num leading-tight">{formatEuro(lastSale.changeCents)}</div>
                        </>
                      ) : (
                        <div className="text-sm mt-1">Χωρίς ρέστα</div>
                      )}
                      {/* Κινητό: κλείνει το φύλλο για τον επόμενο πελάτη (σε tablet/υπολογιστή το καλάθι φαίνεται πάντα). */}
                      <div className="lg:hidden mt-3">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setSheetOpen(false)}>
                          Επόμενος πελάτης
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-3 py-8 text-center">Πάτησε ένα είδος για να ξεκινήσεις την πώληση.</p>
                  )
                ) : (
                  <ul className="divide-y divide-line">
                    {cart.map((l) => (
                      <li key={l.key} className="py-2">
                        <div className="flex gap-2 items-start">
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" className="btn-secondary btn-sm w-10 px-0! text-lg!" disabled={l.qty <= 1} onClick={() => changeQty(l.key, -1)} aria-label={`Λιγότερο ${l.name}`}>
                              −
                            </button>
                            <span className="w-6 text-center font-bold num">{l.qty}</span>
                            <button type="button" className="btn-secondary btn-sm w-10 px-0! text-lg!" onClick={() => changeQty(l.key, 1)} aria-label={`Περισσότερο ${l.name}`}>
                              +
                            </button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium leading-snug">{l.name}</div>
                            {l.modifiers.length > 0 && <div className="text-xs text-ink-2">{l.modifiers.map((m) => m.name).join(", ")}</div>}
                            {l.notes && noteKey !== l.key && <div className="text-xs italic text-warn">{l.notes}</div>}
                            {noteKey !== l.key && (
                              <button type="button" className="text-xs text-ink-3 underline underline-offset-2 py-0.5" onClick={() => setNoteKey(l.key)} aria-label={`Σημείωση για ${l.name}`}>
                                {l.notes ? "αλλαγή σημείωσης" : "+ σημείωση"}
                              </button>
                            )}
                          </div>
                          <div className="flex flex-col items-end shrink-0">
                            <Money cents={lineTotal(l)} className="text-sm font-semibold" />
                            <button type="button" className="btn-ghost btn-sm text-danger! px-2! py-1!" onClick={() => removeLine(l.key)} aria-label={`Αφαίρεση ${l.name}`}>
                              ✕
                            </button>
                          </div>
                        </div>
                        {noteKey === l.key && (
                          <input
                            autoFocus
                            className="input mt-1.5 text-sm py-1.5"
                            aria-label={`Σημείωση για ${l.name}`}
                            placeholder="π.χ. χωρίς πάγο"
                            maxLength={120}
                            value={l.notes}
                            onChange={(e) => setNote(l.key, e.target.value)}
                            onBlur={() => setNoteKey(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") setNoteKey(null);
                            }}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="p-3 border-t border-line space-y-2" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
                {/* Η έκπτωση φαίνεται ΚΑΙ εδώ: καλάθι και πληρωμή δείχνουν πάντα το ίδιο ποσό. */}
                {discountCents > 0 && (
                  <div className="text-sm space-y-0.5" data-testid="cart-discount">
                    <div className="flex justify-between text-ink-2">
                      <span>Υποσύνολο</span>
                      <Money cents={subtotal} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-warn">
                      <span className="min-w-0 truncate">Έκπτωση · {discount?.reason}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <Money cents={-discountCents} />
                        <button type="button" className="btn-ghost btn-sm text-danger! px-2! py-0.5!" onClick={removeDiscount} aria-label="Αφαίρεση έκπτωσης">
                          ✕
                        </button>
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-ink-2">
                    Σύνολο · <span className="num">{count}</span> {count === 1 ? "είδος" : "είδη"}
                  </span>
                  <Money cents={total} className="font-black text-2xl" />
                </div>
                <div className="flex gap-2">
                  {cart.length > 0 && (
                    <button type="button" className="btn-ghost btn-sm text-danger!" onClick={clearSale} aria-label="Άδειασμα καλαθιού">
                      Άδειασμα
                    </button>
                  )}
                  <button type="button" className="btn-primary btn-lg flex-1 px-3!" disabled={!cart.length} onClick={() => goPay(false)}>
                    Πληρωμή {cart.length ? formatEuro(total) : ""}
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Κινητό: μπάρα καλαθιού */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/85 backdrop-blur-xl border-t border-line px-3 pt-2" style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}>
        <button
          type="button"
          className={`${cart.length ? "btn-primary" : "btn-secondary"} w-full`}
          onClick={() => setSheetOpen(true)}
          aria-label={`Καλάθι, ${count} ${count === 1 ? "είδος" : "είδη"}, ${formatEuro(total)}`}
        >
          <span className="flex-1 text-left">
            Καλάθι · <span className="num">{count}</span>
          </span>
          <span className="num">{formatEuro(total)}</span>
        </button>
      </div>

      {configProduct && (
        <ProductModal
          key={configProduct.id}
          product={configProduct}
          onClose={() => setConfigProduct(null)}
          onAdd={(line) => {
            changeCart((prev) => addLine(prev, line));
            setConfigProduct(null);
          }}
        />
      )}

      {discountOpen && (
        <DiscountModal
          subtotalCents={subtotal}
          currentCents={discountCents}
          currentReason={discount?.reason ?? null}
          onClose={() => setDiscountOpen(false)}
          onApply={(cents, reason) => {
            setDiscount(cents > 0 ? { cents, reason } : null);
            payRef.current = null;
            setDiscountOpen(false);
          }}
        />
      )}

      {ordersOpen && (
        <OrdersSheet
          pending={snap.pending}
          ready={snap.ready}
          shiftId={shift.id}
          canDiscount={canDiscount}
          onClose={() => setOrdersOpen(false)}
          onChanged={() => void refresh()}
          onError={(m) => toast(m, "danger")}
          onPaid={(sale) => {
            setSnap((s) => ({ ...s, pending: s.pending.filter((p) => p.sessionId !== sale.sessionId), shift: s.shift ? withSale(s.shift, sale) : s.shift }));
            setOrdersOpen(false);
            if (!cart.length) {
              setLastSale(sale);
              setSheetOpen(true);
            }
            toast(sale.changeCents > 0 ? `Πληρώθηκε · ${sale.displayNo} · ρέστα ${formatEuro(sale.changeCents)}` : `Πληρώθηκε · ${sale.displayNo}`);
            refreshSoon();
          }}
        />
      )}

      {closeOpen && (
        <CloseShiftModal
          shift={shift}
          blocked={
            retryOnly
              ? "Μια πώληση περιμένει απάντηση από τον server. Πάτησε «Επανάληψη» πριν κλείσεις το ταμείο."
              : cart.length
                ? "Υπάρχει μισοτελειωμένη πώληση στο καλάθι. Ολοκλήρωσέ την ή άδειασε το καλάθι πριν κλείσεις το ταμείο."
                : null
          }
          onClose={() => setCloseOpen(false)}
          onClosed={(final) => {
            setCloseOpen(false);
            setClosed(final);
          }}
        />
      )}
      {element}
    </div>
  );
}

function CategoryButton({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 lg:w-full rounded-xl border px-3 py-2 lg:px-2 lg:py-3 text-sm lg:text-[13px] font-semibold text-left flex items-center gap-2 transition lg:min-h-12 ${
        active ? "bg-ink text-white border-ink" : "bg-white/70 text-ink-2 border-line hover:bg-white"
      }`}
    >
      <span aria-hidden className="w-1.5 self-stretch min-h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="leading-tight break-words min-w-0">{label}</span>
    </button>
  );
}
