"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Field, Modal, Money, Numpad, useToast } from "@/components/ui";
import { formatEuro } from "@/server/money";
import type { ActionResult } from "@/server/action";
import type { Menu } from "@/server/services/catalog";
import type { CartLine } from "@/server/services/ordering";
import type { SessionDto, SessionItemDto } from "@/components/ops/types";
import { ITEM_STATUS_LABEL, ITEM_STATUS_TONE, VOID_REASONS, courseLabel, fmtTime } from "@/components/ops/labels";
import {
  cancelSessionAction,
  markServedAction,
  moveSessionAction,
  printBillAction,
  sendRoundAction,
  setCoversAction,
  voidItemAction,
} from "./actions";

type MenuProduct = Menu[number]["products"][number];
type ModGroup = MenuProduct["modifierGroups"][number];

type UiLine = {
  key: string;
  productId: number;
  name: string;
  unitPriceCents: number;
  qty: number;
  course: number;
  notes: string;
  modifiers: { id: number; name: string; priceDeltaCents: number }[];
};

export type FreeTable = { id: number; name: string; area: string };

const lineTotal = (l: UiLine) => (l.unitPriceCents + l.modifiers.reduce((n, m) => n + m.priceDeltaCents, 0)) * l.qty;
const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function OrderScreen({ session, menu, courses, freeTables }: { session: SessionDto; menu: Menu; courses: number; freeTables: FreeTable[] }) {
  const { toast, element } = useToast();
  const [pending, start] = useTransition();
  const [cart, setCart] = useState<UiLine[]>([]);
  const [roundNotes, setRoundNotes] = useState("");
  const [catId, setCatId] = useState<number | null>(menu[0]?.id ?? null);
  const [configProduct, setConfigProduct] = useState<MenuProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [coversOpen, setCoversOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<SessionItemDto | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const category = menu.find((c) => c.id === catId) ?? menu[0];
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + lineTotal(l), 0);
  const liveItems = session.items.filter((i) => i.status !== "voided");
  const canCancel = liveItems.length === 0 && session.payments.length === 0;

  const addLine = (line: Omit<UiLine, "key">) =>
    setCart((prev) => {
      if (!line.modifiers.length && !line.notes) {
        const idx = prev.findIndex((l) => l.productId === line.productId && !l.modifiers.length && !l.notes && l.course === line.course);
        if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + line.qty } : l));
      }
      return [...prev, { ...line, key: newKey() }];
    });

  const tapProduct = (p: MenuProduct) => {
    if (!p.available) return;
    if (p.modifierGroups.length) setConfigProduct(p);
    else addLine({ productId: p.id, name: p.name, unitPriceCents: p.priceCents, qty: 1, course: 1, notes: "", modifiers: [] });
  };

  const changeQty = (key: string, delta: number) =>
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  const removeLine = (key: string) => setCart((prev) => prev.filter((l) => l.key !== key));

  const send = () => {
    if (!cart.length) return;
    start(async () => {
      const lines: CartLine[] = cart.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        course: l.course,
        notes: l.notes || null,
        modifierIds: l.modifiers.map((m) => m.id),
      }));
      const r = await sendRoundAction(session.id, lines, roundNotes.trim() || null);
      if (!r.ok) return toast(r.error, "danger");
      setCart([]);
      setRoundNotes("");
      setCartOpen(false);
      toast("Στάλθηκε");
    });
  };

  const runSimple = (fn: () => Promise<ActionResult>, okMsg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r && !r.ok) return toast(r.error, "danger");
      toast(okMsg);
      after?.();
    });

  const cartPanel = (
    <CartPanel
      cart={cart}
      count={cartCount}
      total={cartTotal}
      roundNotes={roundNotes}
      onNotes={setRoundNotes}
      onQty={changeQty}
      onRemove={removeLine}
      onSend={send}
      pending={pending}
    />
  );

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-12 z-30 bg-surface-2 border-b border-line">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 h-14 flex items-center gap-2">
          <Link href="/pda" className="btn-ghost btn-sm px-2" aria-label="Πίσω στα τραπέζια">
            ‹ <span className="hidden sm:inline">Τραπέζια</span>
          </Link>
          <div className="min-w-0">
            <div className="font-bold text-lg leading-tight truncate">{session.displayName}</div>
            <div className="text-xs text-ink-3 truncate num">
              {session.waiter} · {fmtTime(session.openedAt)}
            </div>
          </div>
          <button type="button" className="btn-secondary btn-sm ml-auto whitespace-nowrap" onClick={() => setCoversOpen(true)}>
            <span className="num">{session.covers}</span> άτ.
          </button>
          <div className="text-right leading-tight">
            {session.totals.discountCents > 0 && (
              <div className="text-xs text-warn num">−{formatEuro(session.totals.discountCents)}</div>
            )}
            <Money cents={session.totals.totalCents} className="font-bold text-lg" />
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:flex md:items-start md:gap-4 pb-28 md:pb-4">
        <div className="flex-1 min-w-0 space-y-4">
          <section className="space-y-3">
            <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1 touch">
              {menu.map((c) => {
                const active = category?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCatId(c.id)}
                    className={`shrink-0 rounded-full pl-3 pr-4 py-2 text-sm font-semibold border flex items-center gap-2 transition ${
                      active ? "bg-ink text-white border-ink" : "bg-surface-2 text-ink-2 border-line hover:bg-surface-3"
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </button>
                );
              })}
            </div>
            {!category ? (
              <p className="text-sm text-ink-3">Το μενού είναι κενό.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                {category.products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!p.available}
                    onClick={() => tapProduct(p)}
                    className="card p-3 min-h-[80px] text-left flex flex-col touch transition active:scale-[0.98] border-l-4 disabled:opacity-50 disabled:bg-surface-3"
                    style={{ borderLeftColor: category.color }}
                  >
                    <span className="font-semibold leading-snug">{p.name}</span>
                    <span className="mt-auto pt-1.5 flex items-center justify-between gap-1 text-sm">
                      {p.available ? <Money cents={p.priceCents} className="text-ink-2" /> : <Badge tone="danger">Εξαντλήθηκε</Badge>}
                      {p.modifierGroups.length > 0 && p.available && <span className="text-xs text-ink-3">επιλογές ›</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Παραγγελία</h2>
              <span className="text-xs text-ink-3">
                {session.rounds.length} {session.rounds.length === 1 ? "γύρος" : "γύροι"}
              </span>
            </div>
            {session.rounds.length === 0 ? (
              <p className="text-sm text-ink-3">Δεν έχει σταλεί τίποτα ακόμη.</p>
            ) : (
              session.rounds.map((r) => (
                <div key={r.id} className="border-t border-line pt-2">
                  <div className="flex items-center gap-2 text-xs text-ink-3 mb-1.5">
                    <span className="font-semibold text-ink-2">Γύρος {r.roundNo}</span>
                    <span className="num">{fmtTime(r.createdAt)}</span>
                    <span>· {r.employee}</span>
                  </div>
                  {r.notes && <div className="text-xs italic text-warn mb-1">Σημ.: {r.notes}</div>}
                  <ul className="space-y-2">
                    {r.items.map((i) => (
                      <SentItem key={i.id} item={i} onVoid={() => setVoidTarget(i)} />
                    ))}
                  </ul>
                </div>
              ))
            )}
            <div className="border-t border-line pt-2 text-sm space-y-1">
              <div className="flex justify-between text-ink-2">
                <span>Υποσύνολο</span>
                <Money cents={session.totals.subtotalCents} />
              </div>
              {session.totals.discountCents > 0 && (
                <div className="flex justify-between text-warn">
                  <span>Έκπτωση{session.discountReason ? ` (${session.discountReason})` : ""}</span>
                  <Money cents={-session.totals.discountCents} />
                </div>
              )}
              {session.totals.paidCents > 0 && (
                <div className="flex justify-between text-ok">
                  <span>Πληρωμένα</span>
                  <Money cents={session.totals.paidCents} />
                </div>
              )}
              <div className="flex justify-between font-bold text-base">
                <span>Σύνολο</span>
                <Money cents={session.totals.totalCents} />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || liveItems.length === 0}
              onClick={() => runSimple(() => printBillAction(session.id), "Ο λογαριασμός στάλθηκε για εκτύπωση")}
            >
              Λογαριασμός
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || !liveItems.some((i) => i.status === "ready")}
              onClick={() => runSimple(() => markServedAction(session.id), "Σημειώθηκαν ως σερβιρισμένα")}
            >
              Σερβιρίστηκαν
            </button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setMoveOpen(true)}>
              Μεταφορά
            </button>
            <button type="button" className="btn-danger" disabled={pending || !canCancel} onClick={() => setCancelOpen(true)}>
              Ακύρωση τραπεζιού
            </button>
          </section>
        </div>

        <aside className="hidden md:block w-80 lg:w-96 shrink-0 md:sticky md:top-[6.75rem]">
          <div className="card p-4 max-h-[calc(100vh-8rem)] overflow-y-auto">{cartPanel}</div>
        </aside>
      </div>

      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface-2 border-t border-line px-3 pt-3 flex items-center gap-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-semibold">
            <span className="num">{cartCount}</span> {cartCount === 1 ? "είδος" : "είδη"}
          </div>
          <Money cents={cartTotal} className="text-sm text-ink-2" />
        </div>
        <button type="button" className={`${cart.length ? "btn-primary" : "btn-secondary"} px-6`} onClick={() => setCartOpen(true)}>
          Καλάθι
        </button>
      </div>

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Καλάθι">
        {cartPanel}
      </Modal>

      {configProduct && (
        <ProductModal
          key={configProduct.id}
          product={configProduct}
          courses={courses}
          onClose={() => setConfigProduct(null)}
          onAdd={(line) => {
            addLine(line);
            setConfigProduct(null);
          }}
        />
      )}

      {coversOpen && (
        <CoversModal
          initial={session.covers}
          pending={pending}
          onClose={() => setCoversOpen(false)}
          onSubmit={(n) => runSimple(() => setCoversAction(session.id, n), "Ενημερώθηκαν τα άτομα", () => setCoversOpen(false))}
        />
      )}

      {voidTarget && (
        <VoidModal
          item={voidTarget}
          pending={pending}
          onClose={() => setVoidTarget(null)}
          onSubmit={(reason) => runSimple(() => voidItemAction(voidTarget.id, reason, session.id), "Το είδος ακυρώθηκε", () => setVoidTarget(null))}
        />
      )}

      {moveOpen && (
        <MoveModal
          tables={freeTables}
          pending={pending}
          onClose={() => setMoveOpen(false)}
          onSubmit={(tableId) => runSimple(() => moveSessionAction(session.id, tableId), "Το τραπέζι μεταφέρθηκε", () => setMoveOpen(false))}
        />
      )}

      {cancelOpen && (
        <CancelModal
          name={session.displayName}
          pending={pending}
          onClose={() => setCancelOpen(false)}
          onSubmit={(reason) => runSimple(() => cancelSessionAction(session.id, reason), "Το τραπέζι ακυρώθηκε")}
        />
      )}

      {element}
    </div>
  );
}

/* ------------------------------- Καλάθι ------------------------------- */

function CartPanel({
  cart,
  count,
  total,
  roundNotes,
  onNotes,
  onQty,
  onRemove,
  onSend,
  pending,
}: {
  cart: UiLine[];
  count: number;
  total: number;
  roundNotes: string;
  onNotes: (v: string) => void;
  onQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onSend: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Νέος γύρος</h2>
        <span className="text-xs text-ink-3">
          <span className="num">{count}</span> {count === 1 ? "είδος" : "είδη"}
        </span>
      </div>
      {cart.length === 0 ? (
        <p className="text-sm text-ink-3 py-6 text-center">Πάτησε ένα είδος από το μενού.</p>
      ) : (
        <ul className="divide-y divide-line">
          {cart.map((l) => (
            <li key={l.key} className="py-2 flex gap-2 items-start">
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" className="btn-secondary btn-sm w-10 px-0 text-lg" onClick={() => onQty(l.key, -1)} aria-label="Λιγότερο">
                  −
                </button>
                <span className="w-7 text-center font-bold num">{l.qty}</span>
                <button type="button" className="btn-secondary btn-sm w-10 px-0 text-lg" onClick={() => onQty(l.key, 1)} aria-label="Περισσότερο">
                  +
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium leading-snug">{l.name}</div>
                {l.modifiers.length > 0 && <div className="text-xs text-ink-2">{l.modifiers.map((m) => m.name).join(", ")}</div>}
                {l.notes && <div className="text-xs italic text-warn">{l.notes}</div>}
                <div className="mt-1 flex items-center gap-2">
                  <Badge>{courseLabel(l.course)}</Badge>
                  <Money cents={lineTotal(l)} className="text-sm text-ink-2" />
                </div>
              </div>
              <button type="button" className="btn-ghost btn-sm text-danger px-2" onClick={() => onRemove(l.key)} aria-label="Αφαίρεση">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <input className="input" placeholder="Σημείωση γύρου (προαιρετικό)" value={roundNotes} onChange={(e) => onNotes(e.target.value)} />
      <div className="flex items-center justify-between">
        <span className="text-ink-2">Σύνολο γύρου</span>
        <Money cents={total} className="font-bold text-lg" />
      </div>
      <button type="button" className="btn-primary w-full btn-lg" disabled={!cart.length || pending} onClick={onSend}>
        {pending ? "Αποστολή…" : "Αποστολή στην κουζίνα"}
      </button>
    </div>
  );
}

/* ---------------------------- Σταλμένο είδος --------------------------- */

function SentItem({ item, onVoid }: { item: SessionItemDto; onVoid: () => void }) {
  const voided = item.status === "voided";
  const strike = voided ? "line-through" : "";
  return (
    <li className={`flex gap-2 items-start ${voided ? "opacity-60" : ""}`}>
      <span className={`num font-bold w-8 shrink-0 ${strike}`}>{item.qty}×</span>
      <div className="min-w-0 flex-1">
        <div className={`font-medium leading-snug ${strike}`}>{item.name}</div>
        {item.modifiers.length > 0 && <div className="text-xs text-ink-2">{item.modifiers.map((m) => m.name).join(", ")}</div>}
        {item.notes && <div className="text-xs italic text-warn">{item.notes}</div>}
        {voided && item.voidReason && <div className="text-xs text-danger">Αιτία: {item.voidReason}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={ITEM_STATUS_TONE[item.status]}>{ITEM_STATUS_LABEL[item.status]}</Badge>
          <Badge>{courseLabel(item.course)}</Badge>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Money cents={item.lineTotalCents} className={`text-sm ${strike}`} />
        {!voided && (
          <button type="button" className="btn-ghost btn-sm text-danger px-2 py-1" onClick={onVoid}>
            Ακύρωση
          </button>
        )}
      </div>
    </li>
  );
}

/* --------------------------- Επιλογές είδους --------------------------- */

function ProductModal({
  product,
  courses,
  onClose,
  onAdd,
}: {
  product: MenuProduct;
  courses: number;
  onClose: () => void;
  onAdd: (line: Omit<UiLine, "key">) => void;
}) {
  const [sel, setSel] = useState<Record<number, number[]>>({});
  const [qty, setQty] = useState(1);
  const [course, setCourse] = useState(1);
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
                  <button key={m.id} type="button" onClick={() => toggle(g, m.id)} className={`${on ? "btn-primary" : "btn-secondary"} justify-between text-left`}>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">Ποσότητα</span>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-secondary btn-sm w-11 px-0 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Λιγότερο">
                −
              </button>
              <span className="flex-1 text-center text-xl font-bold num">{qty}</span>
              <button type="button" className="btn-secondary btn-sm w-11 px-0 text-lg" onClick={() => setQty((q) => q + 1)} aria-label="Περισσότερο">
                +
              </button>
            </div>
          </div>
          <div>
            <span className="label">Πιάτο</span>
            <div className="flex gap-1">
              {Array.from({ length: courses }, (_, i) => i + 1).map((c) => (
                <button key={c} type="button" onClick={() => setCourse(c)} className={`${course === c ? "btn-primary" : "btn-secondary"} btn-sm flex-1 px-0`}>
                  {c}ο
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="Σημείωση">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="π.χ. χωρίς αλάτι" />
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
              course,
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

/* ------------------------------- Άτομα -------------------------------- */

function CoversModal({ initial, pending, onClose, onSubmit }: { initial: number; pending: boolean; onClose: () => void; onSubmit: (n: number) => void }) {
  const [value, setValue] = useState(initial ? String(initial) : "");
  return (
    <Modal open onClose={onClose} title="Άτομα στο τραπέζι">
      <div className="h-12 flex items-center justify-center text-3xl font-bold num mb-2">{value || <span className="text-ink-3 text-base font-normal">0</span>}</div>
      <Numpad value={value} onChange={setValue} onSubmit={() => onSubmit(Number(value || 0))} mode="int" submitLabel={pending ? "..." : "OK"} disabled={pending} />
    </Modal>
  );
}

/* ------------------------------ Ακύρωση είδους ------------------------------ */

function VoidModal({ item, pending, onClose, onSubmit }: { item: SessionItemDto; pending: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title="Ακύρωση είδους">
      <div className="space-y-4">
        <div className="text-ink-2">
          <span className="font-semibold text-ink">
            {item.qty}× {item.name}
          </span>
          {item.modifiers.length > 0 && <span className="text-sm"> ({item.modifiers.map((m) => m.name).join(", ")})</span>}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {VOID_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={reason === r ? "btn-primary" : "btn-secondary"}>
              {r}
            </button>
          ))}
        </div>
        <Field label="Άλλη αιτία">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Γράψε αιτία…" />
        </Field>
        <button type="button" className="btn-danger w-full btn-lg" disabled={!reason.trim() || pending} onClick={() => onSubmit(reason.trim())}>
          {pending ? "Ακύρωση…" : "Ακύρωση είδους"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------- Μεταφορά ------------------------------- */

function MoveModal({ tables, pending, onClose, onSubmit }: { tables: FreeTable[]; pending: boolean; onClose: () => void; onSubmit: (tableId: number) => void }) {
  const areas = [...new Set(tables.map((t) => t.area))];
  return (
    <Modal open onClose={onClose} title="Μεταφορά σε τραπέζι" wide>
      {tables.length === 0 ? (
        <p className="text-ink-3 text-center py-6">Δεν υπάρχει ελεύθερο τραπέζι.</p>
      ) : (
        <div className="space-y-4">
          {areas.map((a) => (
            <div key={a}>
              <div className="label">{a}</div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {tables
                  .filter((t) => t.area === a)
                  .map((t) => (
                    <button key={t.id} type="button" className="btn-secondary text-lg py-4" disabled={pending} onClick={() => onSubmit(t.id)}>
                      {t.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* --------------------------- Ακύρωση τραπεζιού --------------------------- */

function CancelModal({ name, pending, onClose, onSubmit }: { name: string; pending: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title="Ακύρωση τραπεζιού">
      <div className="space-y-4">
        <p className="text-ink-2">
          Το «{name}» θα κλείσει χωρίς χρέωση. Η ενέργεια καταγράφεται.
        </p>
        <Field label="Αιτία">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="π.χ. Άνοιξε κατά λάθος" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Πίσω
          </button>
          <button type="button" className="btn-danger" disabled={pending} onClick={() => onSubmit(reason)}>
            {pending ? "Ακύρωση…" : "Ακύρωση"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
