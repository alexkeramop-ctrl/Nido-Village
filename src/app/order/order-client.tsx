"use client";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Field, Modal, Money, useToast } from "@/components/ui";
import { formatEuro } from "@/server/money";
import type { Menu } from "@/server/services/catalog";
import type { CartLine } from "@/server/services/ordering";
import { placeQrOrderAction } from "./actions";
import { CART_KEY, CUSTOMER_KEY, parseJson, setStoredJson, useStoredValue } from "./cart-store";

type MenuProduct = Menu[number]["products"][number];
type ModGroup = MenuProduct["modifierGroups"][number];

type UiLine = {
  key: string;
  productId: number;
  name: string;
  unitPriceCents: number;
  qty: number;
  notes: string;
  modifiers: { id: number; name: string; priceDeltaCents: number }[];
};

const MAX_QTY = 20;
const MAX_LINES = 30;

const lineTotal = (l: UiLine) => (l.unitPriceCents + l.modifiers.reduce((n, m) => n + m.priceDeltaCents, 0)) * l.qty;
const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sameLine = (a: UiLine, b: Omit<UiLine, "key">) =>
  a.productId === b.productId &&
  a.notes === b.notes &&
  a.modifiers.length === b.modifiers.length &&
  a.modifiers.every((m, i) => m.id === b.modifiers[i]?.id);

/**
 * Επαναφορά καλαθιού από το localStorage: κρατάμε μόνο γραμμές που ταιριάζουν με το τρέχον μενού
 * (διαθέσιμο είδος, υπάρχουσες επιλογές) και ξαναϋπολογίζουμε τις τιμές από το μενού.
 */
function restoreCart(raw: unknown, menu: Menu): UiLine[] {
  if (!Array.isArray(raw)) return [];
  const products = new Map<number, MenuProduct>();
  for (const c of menu) for (const p of c.products) products.set(p.id, p);
  const out: UiLine[] = [];
  for (const item of raw as Partial<UiLine>[]) {
    const p = item && typeof item.productId === "number" ? products.get(item.productId) : undefined;
    if (!p || !p.available) continue;
    const allMods = p.modifierGroups.flatMap((g) => g.modifiers);
    const modifiers: UiLine["modifiers"] = [];
    let valid = true;
    for (const m of Array.isArray(item.modifiers) ? item.modifiers : []) {
      const found = allMods.find((x) => x.id === m?.id);
      if (!found) {
        valid = false;
        break;
      }
      modifiers.push({ id: found.id, name: found.name, priceDeltaCents: found.priceDeltaCents });
    }
    if (!valid) continue;
    const qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(item.qty) || 1)));
    out.push({ key: typeof item.key === "string" ? item.key : newKey(), productId: p.id, name: p.name, unitPriceCents: p.priceCents, qty, notes: typeof item.notes === "string" ? item.notes.slice(0, 120) : "", modifiers });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

type StoredCustomer = { name?: string; phone?: string };

export function OrderClient({ menu, venueName }: { menu: Menu; venueName: string }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  // Το καλάθι ζει στο localStorage (null στον server -> άδειο καλάθι, ίδιο HTML σε server και client).
  const rawCart = useStoredValue(CART_KEY);
  const cart = useMemo(() => restoreCart(parseJson<unknown>(rawCart), menu), [rawCart, menu]);
  const setCart = (next: UiLine[]) => setStoredJson(CART_KEY, next);
  const storedCustomer = parseJson<StoredCustomer>(useStoredValue(CUSTOMER_KEY));
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [phoneEdit, setPhoneEdit] = useState<string | null>(null);
  const name = nameEdit ?? String(storedCustomer?.name ?? "").slice(0, 40);
  const phone = phoneEdit ?? String(storedCustomer?.phone ?? "").slice(0, 20);
  const [orderNotes, setOrderNotes] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [configProduct, setConfigProduct] = useState<MenuProduct | null>(null);
  const [activeCat, setActiveCat] = useState<number | null>(menu[0]?.id ?? null);
  const stickyRef = useRef<HTMLDivElement>(null);

  // Ενεργή κατηγορία ανάλογα με το scroll.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const offset = (stickyRef.current?.offsetHeight ?? 0) + 12;
        let current: number | null = menu[0]?.id ?? null;
        for (const c of menu) {
          const el = document.getElementById(`cat-${c.id}`);
          if (el && el.getBoundingClientRect().top <= offset) current = c.id;
        }
        setActiveCat(current);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [menu]);

  const scrollToCat = (id: number) => {
    const el = document.getElementById(`cat-${id}`);
    if (!el) return;
    const offset = (stickyRef.current?.offsetHeight ?? 0) + 8;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
    setActiveCat(id);
  };

  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + lineTotal(l), 0);
  const inCart = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of cart) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
    return m;
  }, [cart]);

  const addLine = (line: Omit<UiLine, "key">) => {
    const idx = cart.findIndex((l) => sameLine(l, line));
    if (idx >= 0) {
      setCart(cart.map((l, i) => (i === idx ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty) } : l)));
      return toast(`${line.name}: +${line.qty}`);
    }
    if (cart.length >= MAX_LINES) return toast(`Έως ${MAX_LINES} διαφορετικά είδη ανά παραγγελία`, "danger");
    setCart([...cart, { ...line, key: newKey() }]);
    toast(`Προστέθηκε: ${line.name}`);
  };

  const tapProduct = (p: MenuProduct) => {
    if (!p.available) return;
    if (p.modifierGroups.length) setConfigProduct(p);
    else addLine({ productId: p.id, name: p.name, unitPriceCents: p.priceCents, qty: 1, notes: "", modifiers: [] });
  };

  const changeQty = (key: string, delta: number) => setCart(cart.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, Math.max(1, l.qty + delta)) } : l)));
  const removeLine = (key: string) => setCart(cart.filter((l) => l.key !== key));

  const submit = () => {
    const n = name.trim();
    const ph = phone.replace(/\s+/g, "").trim();
    if (!cart.length) return toast("Το καλάθι είναι άδειο", "danger");
    if (n.length < 2 || n.length > 40) return toast("Γράψε το όνομά σου (2–40 χαρακτήρες)", "danger");
    if (ph && !/^\+?\d{10,14}$/.test(ph)) return toast("Το τηλέφωνο δεν φαίνεται σωστό", "danger");
    setStoredJson(CUSTOMER_KEY, { name: n, phone: ph });
    const lines: CartLine[] = cart.map((l) => ({ productId: l.productId, qty: l.qty, notes: l.notes || null, modifierIds: l.modifiers.map((m) => m.id) }));
    const snapshot = cart;
    start(async () => {
      // Σε επιτυχία το action κάνει redirect: το Next απορρίπτει το promise με redirect error (το χειρίζεται το RedirectBoundary),
      // οπότε καθαρίζουμε το καλάθι πριν την κλήση και το επαναφέρουμε μόνο αν η αποστολή αποτύχει.
      setStoredJson(CART_KEY, null);
      try {
        const r = await placeQrOrderAction({ customerName: n, customerPhone: ph || null, notes: orderNotes.trim() || null, lines });
        if (r && !r.ok) {
          setStoredJson(CART_KEY, snapshot);
          toast(r.error, "danger");
        }
      } catch (e) {
        unstable_rethrow(e);
        setStoredJson(CART_KEY, snapshot);
        toast("Η παραγγελία δεν στάλθηκε. Έλεγξε τη σύνδεση και δοκίμασε ξανά.", "danger");
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col max-w-lg w-full mx-auto min-h-full">
      <div ref={stickyRef} className="sticky top-0 z-30 bg-surface">
        <header className="bg-brand text-white px-4 pt-4 pb-3">
          <div className="text-xs uppercase tracking-widest text-white/80 font-semibold">{venueName}</div>
          <h1 className="text-2xl font-bold leading-tight mt-0.5">Παραγγελία για παραλαβή</h1>
          <p className="text-sm text-white/90 mt-1">Πληρώνεις στο ταμείο όταν παραλάβεις.</p>
        </header>
        {menu.length > 0 && (
          <nav aria-label="Κατηγορίες" className="bg-surface-2 border-b border-line">
            <div className="flex gap-2 overflow-x-auto px-3 py-2 touch [scrollbar-width:none]">
              {menu.map((c) => {
                const active = activeCat === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => scrollToCat(c.id)}
                    className={`shrink-0 rounded-full pl-3 pr-4 py-2 text-sm font-semibold border flex items-center gap-2 transition ${
                      active ? "bg-ink text-white border-ink" : "bg-surface-2 text-ink-2 border-line"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      <main className="flex-1 px-3 pt-3 pb-32 space-y-6">
        {menu.length === 0 ? (
          <div className="card p-8 text-center text-ink-3">
            <div className="text-lg font-medium text-ink-2">Το μενού δεν είναι διαθέσιμο αυτή τη στιγμή</div>
            <div className="text-sm mt-1">Ρώτησε στο ταμείο για την παραγγελία σου.</div>
          </div>
        ) : (
          menu.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-title-${c.id}`}>
              <h2 id={`cat-title-${c.id}`} className="flex items-center gap-2 text-lg font-bold mb-2 px-1">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                {c.name}
              </h2>
              <ul className="card divide-y divide-line overflow-hidden">
                {c.products.map((p) => {
                  const qty = inCart.get(p.id) ?? 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => tapProduct(p)}
                        className="w-full text-left px-4 py-3.5 flex items-center gap-3 touch transition active:bg-surface-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold leading-snug">{p.name}</div>
                          {p.modifierGroups.length > 0 && <div className="text-xs text-ink-3 mt-0.5">με επιλογές ›</div>}
                        </div>
                        {qty > 0 && (
                          <span className="chip bg-brand text-white num" aria-label={`${qty} στο καλάθι`}>
                            {qty}
                          </span>
                        )}
                        <Money cents={p.priceCents} className="font-semibold text-ink-2 shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </main>

      {menu.length > 0 && (
        <div
          className="fixed bottom-0 inset-x-0 z-30 bg-surface-2 border-t border-line"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="max-w-lg mx-auto px-3 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-semibold">
                <span className="num">{cartCount}</span> {cartCount === 1 ? "είδος" : "είδη"}
              </div>
              <Money cents={cartTotal} className="text-sm text-ink-2" />
            </div>
            <button type="button" className={`${cart.length ? "btn-primary" : "btn-secondary"} px-6`} onClick={() => setCartOpen(true)}>
              Καλάθι
              {cartCount > 0 && <span className="chip bg-white/20 text-white num">{cartCount}</span>}
            </button>
          </div>
        </div>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Το καλάθι σου">
        <div className="space-y-4">
          {cart.length === 0 ? (
            <p className="text-sm text-ink-3 py-6 text-center">Το καλάθι είναι άδειο. Διάλεξε κάτι από το μενού.</p>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l) => (
                <li key={l.key} className="py-2.5 flex gap-2 items-start">
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" className="btn-secondary btn-sm w-10 px-0 text-lg" onClick={() => changeQty(l.key, -1)} aria-label="Λιγότερο">
                      −
                    </button>
                    <span className="w-7 text-center font-bold num">{l.qty}</span>
                    <button type="button" className="btn-secondary btn-sm w-10 px-0 text-lg" onClick={() => changeQty(l.key, 1)} aria-label="Περισσότερο">
                      +
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium leading-snug">{l.name}</div>
                    {l.modifiers.length > 0 && <div className="text-xs text-ink-2">{l.modifiers.map((m) => m.name).join(", ")}</div>}
                    {l.notes && <div className="text-xs italic text-warn">{l.notes}</div>}
                    <Money cents={lineTotal(l)} className="text-sm text-ink-2" />
                  </div>
                  <button type="button" className="btn-ghost btn-sm text-danger px-2" onClick={() => removeLine(l.key)} aria-label={`Αφαίρεση ${l.name}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-ink-2">Σύνολο</span>
            <Money cents={cartTotal} className="font-bold text-xl" />
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Σημείωση για την παραγγελία">
              <input className="input" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value.slice(0, 200))} placeholder="προαιρετικό, π.χ. χωρίς κρεμμύδι" />
            </Field>
            <Field label="Το όνομά σου *">
              <input
                className="input"
                name="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={40}
                value={name}
                onChange={(e) => setNameEdit(e.target.value.slice(0, 40))}
                placeholder="π.χ. Κώστας"
              />
            </Field>
            <Field label="Τηλέφωνο" hint="προαιρετικό · για να σε καλέσουμε αν χρειαστεί">
              <input
                className="input"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhoneEdit(e.target.value.slice(0, 20))}
                placeholder="69xxxxxxxx"
              />
            </Field>
            <div className="rounded-xl bg-brand-soft/60 text-brand-2 text-sm px-3 py-2">
              Η πληρωμή γίνεται στο ταμείο όταν παραλάβεις. Θα δεις τον κωδικό παραλαβής σου αμέσως μετά.
            </div>
            <button type="submit" className="btn-primary w-full btn-lg" disabled={!cart.length || pending}>
              {pending ? "Αποστολή…" : "Αποστολή παραγγελίας"}
            </button>
          </form>
        </div>
      </Modal>

      {configProduct && (
        <ProductSheet
          key={configProduct.id}
          product={configProduct}
          onClose={() => setConfigProduct(null)}
          onAdd={(line) => {
            addLine(line);
            setConfigProduct(null);
          }}
        />
      )}

      {element}
    </div>
  );
}

/* --------------------------- Επιλογές είδους --------------------------- */

function ProductSheet({ product, onClose, onAdd }: { product: MenuProduct; onClose: () => void; onAdd: (line: Omit<UiLine, "key">) => void }) {
  const [sel, setSel] = useState<Record<number, number[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  const toggle = (g: ModGroup, id: number) =>
    setSel((prev) => {
      const cur = prev[g.id] ?? [];
      if (cur.includes(id)) return { ...prev, [g.id]: cur.filter((x) => x !== id) };
      if (g.maxSelect <= 1) return { ...prev, [g.id]: [id] };
      if (cur.length >= g.maxSelect) return prev;
      return { ...prev, [g.id]: [...cur, id] };
    });

  const valid = product.modifierGroups.every((g) => (sel[g.id]?.length ?? 0) >= g.minSelect);
  const chosen = product.modifierGroups.flatMap((g) => g.modifiers.filter((m) => (sel[g.id] ?? []).includes(m.id)));
  const unit = product.priceCents + chosen.reduce((n, m) => n + m.priceDeltaCents, 0);

  return (
    <Modal open onClose={onClose} title={product.name}>
      <div className="space-y-4">
        <div className="text-sm text-ink-2">
          Τιμή: <Money cents={product.priceCents} className="font-semibold text-ink" />
        </div>
        {product.modifierGroups.map((g) => (
          <div key={g.id}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="label mb-0">{g.name}</span>
              <span className="text-xs text-ink-3">
                {g.maxSelect <= 1
                  ? g.minSelect > 0
                    ? "υποχρεωτικό"
                    : "προαιρετικό"
                  : `έως ${g.maxSelect}${g.minSelect > 0 ? ` · τουλάχιστον ${g.minSelect}` : ""}`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {g.modifiers.map((m) => {
                const on = (sel[g.id] ?? []).includes(m.id);
                return (
                  <button key={m.id} type="button" onClick={() => toggle(g, m.id)} aria-pressed={on} className={`${on ? "btn-primary" : "btn-secondary"} justify-between text-left`}>
                    <span className="truncate">{m.name}</span>
                    {m.priceDeltaCents !== 0 && (
                      <span className="text-xs num opacity-80 shrink-0">
                        {m.priceDeltaCents > 0 ? "+" : ""}
                        {formatEuro(m.priceDeltaCents)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div>
          <span className="label">Ποσότητα</span>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-secondary btn-sm w-12 px-0 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Λιγότερο">
              −
            </button>
            <span className="flex-1 text-center text-xl font-bold num">{qty}</span>
            <button type="button" className="btn-secondary btn-sm w-12 px-0 text-lg" onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))} aria-label="Περισσότερο">
              +
            </button>
          </div>
        </div>

        <Field label="Σημείωση">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 120))} placeholder="π.χ. χωρίς αλάτι" />
        </Field>

        <button
          type="button"
          className="btn-primary w-full btn-lg"
          disabled={!valid}
          onClick={() =>
            onAdd({
              productId: product.id,
              name: product.name,
              unitPriceCents: product.priceCents,
              qty,
              notes: notes.trim(),
              modifiers: chosen.map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents })),
            })
          }
        >
          Προσθήκη · {formatEuro(unit * qty)}
        </button>
      </div>
    </Modal>
  );
}
