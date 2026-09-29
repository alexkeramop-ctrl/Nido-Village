"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Badge, EmptyState, Field, Modal, Money, useToast } from "@/components/ui";
import { ZoomableFloorMap, isPlaced, type FloorMapImage, type FloorMapTable } from "@/components/floor-map";
import { formatEuro } from "@/server/money";
import type { TableShape } from "@/db/schema";
import { openTableAction, openTakeawayAction } from "./actions";

export type FloorSessionDto = {
  id: number;
  openedAt: string;
  covers?: number;
  status: "open" | "billed";
  waiter: string;
  itemCount: number;
  totalCents: number;
  minutesOpen: number;
};

export type FloorTableDto = {
  id: number;
  name: string;
  seats: number;
  posX: number | null;
  posY: number | null;
  shape: TableShape;
  session: FloorSessionDto | null;
};

export type FloorAreaDto = {
  id: number;
  name: string;
  image: FloorMapImage;
  tables: FloorTableDto[];
};

export type TakeawayDto = FloorSessionDto & { label: string; orderType: "takeaway" | "delivery" };

/* --------------------------- Προτίμηση προβολής --------------------------- */

type View = "map" | "list";
const VIEW_KEY = "nido.pda.floorView";
const VIEW_EVENT = "nido:floorView";

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "map";
  } catch {
    return "map";
  }
}
function subscribeView(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(VIEW_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(VIEW_EVENT, cb);
  };
}
function writeView(v: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* ιδιωτική περιήγηση κ.λπ. */
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}
/** Η προβολή (χάρτης/λίστα) από το localStorage· στον server πάντα «χάρτης». */
function useFloorView(): View {
  return useSyncExternalStore(subscribeView, readView, () => "map");
}

/* ------------------------------ Κάρτες λίστας ------------------------------ */

function StatusChip({ status }: { status: "open" | "billed" }) {
  return status === "billed" ? <Badge tone="warn">Λογαριασμός</Badge> : <Badge tone="brand">Ανοιχτό</Badge>;
}

function OccupiedBody({ s, name, sub }: { s: FloorSessionDto; name: string; sub?: string }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xl font-bold leading-tight truncate">{name}</span>
        <StatusChip status={s.status} />
      </div>
      <div className="text-sm text-ink-2 mt-1 truncate">
        {s.waiter}
        {sub ? ` · ${sub}` : ""}
        {(s.covers ?? 0) > 0 ? ` · ${s.covers} άτ.` : ""}
      </div>
      <div className="mt-auto pt-2 flex items-end justify-between">
        <span className="text-xs text-ink-3 num">
          {s.minutesOpen}′ · {s.itemCount} είδη
        </span>
        <Money cents={s.totalCents} className="font-bold" />
      </div>
    </>
  );
}

const CARD = "card p-3 min-h-[108px] flex flex-col text-left touch transition active:scale-[0.98]";

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opt = (v: View, label: string) => (
    <button
      type="button"
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition touch ${value === v ? "bg-brand text-white" : "text-ink-2 hover:bg-surface-3"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Προβολή" className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5 shrink-0">
      {opt("map", "Χάρτης")}
      {opt("list", "Λίστα")}
    </div>
  );
}

export function FloorScreen({ areas, takeaway }: { areas: FloorAreaDto[]; takeaway: TakeawayDto[] }) {
  const router = useRouter();
  const [areaId, setAreaId] = useState<number | null>(areas[0]?.id ?? null);
  const [pendingTable, setPendingTable] = useState<number | null>(null);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [pending, start] = useTransition();
  const { toast, element } = useToast();
  const view = useFloorView();
  const area = areas.find((a) => a.id === areaId) ?? areas[0];

  const openTable = (tableId: number) => {
    setPendingTable(tableId);
    start(async () => {
      const r = await openTableAction(tableId);
      if (r && !r.ok) toast(r.error, "danger");
      setPendingTable(null);
    });
  };

  const placedTables = area ? area.tables.filter(isPlaced) : [];
  const unplaced = area ? area.tables.filter((t) => !isPlaced(t)) : [];
  const hasMap = placedTables.length > 0;
  const showMap = hasMap && view === "map";
  const occupied = area ? area.tables.filter((t) => t.session).length : 0;

  const markers: FloorMapTable[] = placedTables.map((t) => ({
    id: t.id,
    name: t.name,
    seats: t.seats,
    posX: t.posX,
    posY: t.posY,
    shape: t.shape,
    tone: t.session ? (t.session.status === "billed" ? "billed" : "open") : "free",
    label: pendingTable === t.id ? "Άνοιγμα…" : t.session ? `${t.session.minutesOpen}′` : `${t.seats} θέσ.`,
    sub: t.session ? formatEuro(t.session.totalCents) : undefined,
  }));

  const tapTable = (id: number) => {
    const t = area?.tables.find((x) => x.id === id);
    if (!t) return;
    if (t.session) router.push(`/pda/s/${t.session.id}`);
    else if (!pending) openTable(t.id);
  };

  return (
    <main className="flex-1 p-3 sm:p-4 space-y-4 max-w-7xl w-full mx-auto">
      {areas.length > 1 && (
        <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1 touch">
          {areas.map((a) => {
            const n = a.tables.filter((t) => t.session).length;
            const active = area?.id === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAreaId(a.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold border transition ${
                  active ? "bg-brand text-white border-brand" : "bg-surface-2 text-ink-2 border-line hover:bg-surface-3"
                }`}
              >
                {a.name}
                <span className={`ml-1.5 num ${active ? "text-white/80" : "text-ink-3"}`}>
                  {n}/{a.tables.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!area || !area.tables.length ? (
        <EmptyState title="Δεν υπάρχουν τραπέζια" hint="Πρόσθεσε χώρους και τραπέζια από τη Διαχείριση." />
      ) : (
        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            {areas.length === 1 ? (
              <h2 className="font-semibold text-ink-2">{area.name}</h2>
            ) : (
              <span className="text-sm text-ink-3 num">
                {occupied}/{area.tables.length} κατειλημμένα
              </span>
            )}
            {hasMap && <ViewToggle value={view} onChange={writeView} />}
          </div>

          {showMap ? (
            <div data-floor-view="map">
              <ZoomableFloorMap
                key={area.id}
                areaImage={area.image}
                tables={markers}
                onTap={tapTable}
                footer={
                  unplaced.length > 0 ? (
                    <>
                      Χωρίς θέση: {unplaced.map((t) => t.name).join(", ")} <span className="text-ink-3/70">(στη λίστα)</span>
                    </>
                  ) : null
                }
              />
            </div>
          ) : (
            <div data-floor-view="list" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {area.tables.map((t) =>
                t.session ? (
                  <Link key={t.id} href={`/pda/s/${t.session.id}`} className={`${CARD} ${t.session.status === "billed" ? "border-warn bg-warn-soft/40" : "border-brand bg-brand-soft/40"}`}>
                    <OccupiedBody s={t.session} name={t.name} />
                  </Link>
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    disabled={pending}
                    onClick={() => openTable(t.id)}
                    className={`${CARD} hover:border-brand/60 ${pendingTable === t.id ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xl font-bold leading-tight">{t.name}</span>
                      <span className="text-xs text-ink-3 num">{t.seats} θέσ.</span>
                    </div>
                    <div className="mt-auto pt-2 text-sm text-ink-3">{pendingTable === t.id ? "Άνοιγμα…" : "Ελεύθερο"}</div>
                  </button>
                ),
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-ink-2">Πακέτα / Delivery</h2>
          <button type="button" className="btn-primary btn-sm" onClick={() => setPkgOpen(true)}>
            + Πακέτο
          </button>
        </div>
        {takeaway.length === 0 ? (
          <div className="text-sm text-ink-3 px-1">Δεν υπάρχουν ανοιχτά πακέτα.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {takeaway.map((s) => (
              <Link key={s.id} href={`/pda/s/${s.id}`} className={`${CARD} ${s.status === "billed" ? "border-warn bg-warn-soft/40" : "border-brand bg-brand-soft/40"}`}>
                <OccupiedBody s={s} name={s.label} sub={s.orderType === "delivery" ? "Delivery" : "Πακέτο"} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <TakeawayModal open={pkgOpen} onClose={() => setPkgOpen(false)} onError={(m) => toast(m, "danger")} />
      {element}
    </main>
  );
}

function TakeawayModal({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (m: string) => void }) {
  const [label, setLabel] = useState("");
  const [orderType, setOrderType] = useState<"takeaway" | "delivery">("takeaway");
  const [covers, setCovers] = useState("");
  const [pending, start] = useTransition();
  const submit = () => {
    if (!label.trim()) return onError("Δώσε όνομα πελάτη");
    start(async () => {
      const r = await openTakeawayAction({ label: label.trim(), orderType, covers: covers ? Number(covers) : 0 });
      if (r && !r.ok) onError(r.error);
    });
  };
  return (
    <Modal open={open} onClose={onClose} title="Νέο πακέτο / Delivery">
      <div className="space-y-4">
        <Field label="Όνομα πελάτη">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="π.χ. Κώστας – τηλ. 69…" autoFocus />
        </Field>
        <div>
          <span className="label">Τύπος</span>
          <div className="grid grid-cols-2 gap-2">
            {(["takeaway", "delivery"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={orderType === t ? "btn-primary" : "btn-secondary"}
              >
                {t === "takeaway" ? "Πακέτο" : "Delivery"}
              </button>
            ))}
          </div>
        </div>
        <Field label="Άτομα (προαιρετικό)">
          <input className="input" inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value.replace(/\D/g, ""))} placeholder="0" />
        </Field>
        <button type="button" className="btn-primary w-full btn-lg" disabled={pending} onClick={submit}>
          {pending ? "Άνοιγμα…" : "Άνοιγμα"}
        </button>
      </div>
    </Modal>
  );
}
