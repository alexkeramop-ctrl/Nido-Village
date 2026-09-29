"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, EmptyState, Field, Modal, Money, useToast } from "@/components/ui";
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

export type FloorAreaDto = {
  id: number;
  name: string;
  tables: { id: number; name: string; seats: number; session: FloorSessionDto | null }[];
};

export type TakeawayDto = FloorSessionDto & { label: string; orderType: "takeaway" | "delivery" };

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

export function FloorScreen({ areas, takeaway }: { areas: FloorAreaDto[]; takeaway: TakeawayDto[] }) {
  const [areaId, setAreaId] = useState<number | null>(areas[0]?.id ?? null);
  const [pendingTable, setPendingTable] = useState<number | null>(null);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [pending, start] = useTransition();
  const { toast, element } = useToast();
  const area = areas.find((a) => a.id === areaId) ?? areas[0];

  const openTable = (tableId: number) => {
    setPendingTable(tableId);
    start(async () => {
      const r = await openTableAction(tableId);
      if (r && !r.ok) toast(r.error, "danger");
      setPendingTable(null);
    });
  };

  return (
    <main className="flex-1 p-3 sm:p-4 space-y-4 max-w-7xl w-full mx-auto">
      {areas.length > 1 && (
        <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1 touch">
          {areas.map((a) => {
            const occupied = a.tables.filter((t) => t.session).length;
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
                  {occupied}/{a.tables.length}
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
          {areas.length === 1 && <h2 className="font-semibold text-ink-2 mb-2">{area.name}</h2>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
