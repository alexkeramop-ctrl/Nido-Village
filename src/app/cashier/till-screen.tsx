"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Modal, Money, useToast } from "@/components/ui";
import { useLive } from "@/components/live";
import { DiscountModal } from "@/components/ops/discount-modal";
import { ProductModal, type MenuProduct } from "@/components/ops/product-modal";
import { addLine, cartCount, cartTotal, lineTotal, toCartLines, type UiLine } from "@/components/ops/cart";
import { fmtTime } from "@/components/ops/labels";
import { formatEuro } from "@/server/money";
import type { TenderInput } from "@/lib/tender";
import type { Menu } from "@/server/services/catalog";
import type { ShiftDto } from "@/server/services/registers";
import type { SaleResult, TillSnapshot } from "@/server/services/till";
import { quickSaleAction, selectRegisterAction, setShiftQrAction } from "./actions";
import { OrdersSheet } from "./pending-list";
import { PayPanel } from "./pay-panel";
import { CloseShiftModal, ShiftReport } from "./shift-panels";
import { QrAreasPicker, qrSummary, type QrArea, type QrChoice } from "./qr-areas";

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
  frequentIds,
  initial,
  areas,
}: {
  register: { id: number; name: string };
  userName: string;
  canDiscount: boolean;
  menu: Menu;
  frequentIds: number[];
  initial: TillSnapshot;
  areas: QrArea[];
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
  const [payRef, setPayRef] = useState<string | null>(null);
  const [payByKeyboard, setPayByKeyboard] = useState(false);
  const [pending, setPending] = useState(false);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);
  const [configProduct, setConfigProduct] = useState<MenuProduct | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [closed, setClosed] = useState<ShiftDto | null>(null);
  const [qrEdit, setQrEdit] = useState<QrChoice | null>(null);
  const [qrSaving, setQrSaving] = useState(false);
  const submitting = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ----------------------- ανανέωση στο παρασκήνιο ----------------------- */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/till?register=${register.id}`, { cache: "no-store" });
      if (res.ok) setSnap((await res.json()) as TillSnapshot);
    } catch {
      /* εκτός σύνδεσης: κρατάμε ό,τι έχουμε */
    }
  }, [register.id]);
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
  useLive(
    ["session.changed", "kds.changed", "catalog.changed"],
    (e) => {
      if (e.type === "catalog.changed") startTransition(() => router.refresh());
      refreshSoon();
    },
    { pollMs: 15000 },
  );

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

  /** Κάθε αλλαγή στην πώληση ακυρώνει το κλειδί της: νέο περιεχόμενο = νέα πώληση. */
  const changeCart = (fn: (prev: UiLine[]) => UiLine[]) => {
    setCart(fn);
    setPayRef(null);
  };
  const tapProduct = (p: MenuProduct) => {
    if (unavailable.has(p.id)) return;
    setLastSale(null);
    if (p.modifierGroups.length) setConfigProduct(p);
    else changeCart((prev) => addLine(prev, { productId: p.id, name: p.name, unitPriceCents: p.priceCents, qty: 1, course: 1, notes: "", modifiers: [] }));
  };
  const changeQty = (key: string, delta: number) => changeCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.min(99, Math.max(1, l.qty + delta)) } : l)));
  const removeLine = (key: string) => changeCart((prev) => prev.filter((l) => l.key !== key));
  const setNote = (key: string, notes: string) => changeCart((prev) => prev.map((l) => (l.key === key ? { ...l, notes: notes.slice(0, 120) } : l)));
  const clearSale = () => {
    setCart([]);
    setBuzzer("");
    setCustomerName("");
    setDiscount(null);
    setPayRef(null);
    setNoteKey(null);
    setView("cart");
  };

  const goPay = (byKeyboard = false) => {
    if (!cart.length) return;
    if (buzzer && (Number(buzzer) < 1 || Number(buzzer) > 999)) return toast("Ο βομβητής πρέπει να είναι από 1 έως 999", "danger");
    setPayRef((r) => r ?? newClientRef());
    setPayByKeyboard(byKeyboard);
    setNoteKey(null);
    setView("pay");
    setSheetOpen(true);
  };

  /** ΜΙΑ κλήση στον server ανά πώληση. Το ref μπλοκάρει το διπλό πάτημα· το clientRef κάνει την επανάληψη ακίνδυνη. */
  const confirmSale = async (tender: TenderInput) => {
    const shift = snap.shift;
    if (submitting.current || !cart.length || !shift || !payRef) return;
    submitting.current = true;
    setPending(true);
    try {
      const r = await quickSaleAction({
        cashSessionId: shift.id,
        clientRef: payRef,
        buzzerNo: buzzer ? Number(buzzer) : null,
        customerName: customerName.trim() || null,
        lines: toCartLines(cart),
        discount: discountCents > 0 && discount ? { cents: discountCents, reason: discount.reason } : null,
        tender,
      });
      if (!r.ok) {
        toast(r.error, "danger");
        return;
      }
      setLastSale(r.data);
      setSnap((s) => (s.shift ? { ...s, shift: withSale(s.shift, r.data) } : s));
      clearSale();
      refreshSoon();
    } catch {
      toast("Δεν ολοκληρώθηκε (πρόβλημα σύνδεσης). Πάτησε ξανά «Ολοκλήρωση»: δεν θα χρεωθεί δεύτερη φορά.", "danger");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const switchRegister = () => {
    if (cart.length) return toast("Ολοκλήρωσε ή άδειασε πρώτα την πώληση", "danger");
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
            {userName} · βάρδια από <span className="num">{fmtTime(shift.openedAt)}</span> · <span className="num">{shift.salesCount}</span> πωλήσεις
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {areas.length > 0 && (
            <button
              type="button"
              data-testid="qr-areas-chip"
              className="btn btn-sm border bg-white/70 text-ink border-line max-w-[16rem]"
              title="Από ποιους χώρους δέχεται παραγγελίες QR αυτό το ταμείο"
              onClick={() => {
                void refresh();
                setQrEdit({ areaIds: shift.qrAreaIds ?? areas.map((a) => a.id), takeaway: shift.qrTakeaway });
              }}
            >
              <span className="truncate">QR: {qrSummary(areas, shift.qrAreaIds, shift.qrTakeaway)}</span>
            </button>
          )}
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
      <div className="flex-1 min-h-0 grid grid-cols-[6.75rem_minmax(0,1fr)] lg:grid-cols-[8.5rem_minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
        {/* Κατηγορίες: πάντα κάθετη στήλη στο πλάι. Στο κινητό μένει κολλημένη και κυλά μόνη της, δίπλα στα είδη. */}
        <nav
          aria-label="Κατηγορίες"
          className="flex flex-col gap-1.5 overflow-x-hidden overflow-y-auto p-1.5 lg:p-2 border-r border-line bg-white/40 sticky top-12 self-start max-h-[calc(100dvh-8.5rem)] lg:static lg:self-auto lg:max-h-none z-20 backdrop-blur-xl touch"
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
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
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

          {view === "pay" ? (
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
                      setPayRef(null);
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
                      setPayRef(null);
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
                    <div role="status" aria-live="polite" className="my-3 rounded-2xl bg-ok-soft text-ok p-4 text-center" data-testid="last-sale">
                      <div className="text-sm font-semibold">✓ Η πώληση ολοκληρώθηκε · {lastSale.displayNo}</div>
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
                <div className="flex items-center justify-between">
                  <span className="text-ink-2">
                    Σύνολο · <span className="num">{count}</span> {count === 1 ? "είδος" : "είδη"}
                  </span>
                  <Money cents={subtotal} className="font-black text-2xl" />
                </div>
                <div className="flex gap-2">
                  {cart.length > 0 && (
                    <button type="button" className="btn-ghost btn-sm text-danger!" onClick={clearSale} aria-label="Άδειασμα καλαθιού">
                      Άδειασμα
                    </button>
                  )}
                  <button type="button" className="btn-primary btn-lg flex-1 px-3!" disabled={!cart.length} onClick={() => goPay(false)}>
                    Πληρωμή {cart.length ? formatEuro(subtotal) : ""}
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
          aria-label={`Καλάθι, ${count} ${count === 1 ? "είδος" : "είδη"}, ${formatEuro(subtotal)}`}
        >
          <span className="flex-1 text-left">
            Καλάθι · <span className="num">{count}</span>
          </span>
          <span className="num">{formatEuro(subtotal)}</span>
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
            setPayRef(newClientRef());
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
          blocked={cart.length ? "Υπάρχει μισοτελειωμένη πώληση στο καλάθι. Ολοκλήρωσέ την ή άδειασε το καλάθι πριν κλείσεις το ταμείο." : null}
          onClose={() => setCloseOpen(false)}
          onClosed={(final) => {
            setCloseOpen(false);
            setClosed(final);
          }}
        />
      )}
      {qrEdit && (
        <Modal open onClose={() => !qrSaving && setQrEdit(null)} title={`Παραγγελίες QR · ${register.name}`}>
          <div className="space-y-4">
            <QrAreasPicker areas={areas} value={qrEdit} onChange={setQrEdit} others={snap.qrOthers} disabled={qrSaving} />
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" disabled={qrSaving} onClick={() => setQrEdit(null)}>
                Άκυρο
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                data-testid="qr-areas-save"
                disabled={qrSaving}
                onClick={async () => {
                  setQrSaving(true);
                  try {
                    const r = await setShiftQrAction(shift.id, qrEdit);
                    if (!r.ok) return toast(r.error, "danger");
                    setSnap((cur) => (cur.shift ? { ...cur, shift: { ...cur.shift, qrAreaIds: r.data.areaIds, qrTakeaway: r.data.takeaway } } : cur));
                    setQrEdit(null);
                    toast(`QR: ${qrSummary(areas, r.data.areaIds, r.data.takeaway)}`);
                    void refresh();
                  } catch {
                    toast("Δεν αποθηκεύτηκε. Έλεγξε τη σύνδεση.", "danger");
                  } finally {
                    setQrSaving(false);
                  }
                }}
              >
                {qrSaving ? "Αποθήκευση…" : "Αποθήκευση"}
              </button>
            </div>
          </div>
        </Modal>
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
      className={`shrink-0 w-full rounded-xl border px-1.5 py-2.5 lg:px-2 lg:py-3 text-[12px] lg:text-[13px] font-semibold text-left flex items-center gap-1.5 lg:gap-2 transition min-h-12 ${
        active ? "bg-ink text-white border-ink" : "bg-white/70 text-ink-2 border-line hover:bg-white"
      }`}
    >
      <span aria-hidden className="w-1.5 self-stretch min-h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="leading-tight break-words min-w-0">{label}</span>
    </button>
  );
}
