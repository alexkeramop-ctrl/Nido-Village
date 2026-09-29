"use client";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Badge, EmptyState, Field } from "@/components/ui";
import { PageHeader, Section, useActionRunner } from "@/components/admin/common";
import { FloorMap, isPlaced, type FloorMapImage, type FloorMapTable } from "@/components/floor-map";
import type { TableShape } from "@/db/schema";
import { autoLayoutAction, removeAreaMapAction, saveTablePositionsAction, uploadAreaMapAction } from "./actions";

export type EditorTable = { id: number; name: string; seats: number; posX: number | null; posY: number | null; shape: TableShape };
export type EditorArea = { id: number; name: string; image: FloorMapImage; tables: EditorTable[] };

type Edit = { posX: number | null; posY: number | null; shape: TableShape };
/** Τοπικές αλλαγές ανά χώρο -> ανά τραπέζι (ό,τι δεν έχει αποθηκευτεί ακόμα). */
type Edits = Record<number, Record<number, Edit>>;

const SHAPES: { value: TableShape; label: string }[] = [
  { value: "square", label: "Τετράγωνο" },
  { value: "round", label: "Στρογγυλό" },
  { value: "wide", label: "Μακρόστενο" },
];
const MAX_UPLOAD = 3 * 1024 * 1024;
const NUDGE = 5;
const HELP = "Σύρε τα τραπέζια στη θέση τους πάνω στη φωτογραφία. Οι θέσεις εμφανίζονται στο PDA.";

const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/** Διαβάζει τις διαστάσεις μιας εικόνας στον browser (για τον λόγο πλευρών του χάρτη). */
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function mergeTables(area: EditorArea, edits: Record<number, Edit> | undefined): EditorTable[] {
  return area.tables.map((t) => ({ ...t, ...edits?.[t.id] }));
}

export function FloorEditor({ areas }: { areas: EditorArea[] }) {
  const { run, pending, toast, toastElement } = useActionRunner();
  const [areaId, setAreaId] = useState<number | null>(areas[0]?.id ?? null);
  const [edits, setEdits] = useState<Edits>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const area = areas.find((a) => a.id === areaId) ?? areas[0] ?? null;
  const areaEdits = area ? edits[area.id] : undefined;
  const tables = useMemo(() => (area ? mergeTables(area, areaEdits) : []), [area, areaEdits]);
  const dirty = useMemo(
    () =>
      !!area &&
      area.tables.some((o) => {
        const e = areaEdits?.[o.id];
        return !!e && (e.posX !== o.posX || e.posY !== o.posY || e.shape !== o.shape);
      }),
    [area, areaEdits],
  );
  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const placedTables = tables.filter(isPlaced);
  const unplaced = tables.filter((t) => !isPlaced(t));

  // Προειδοποίηση αν φύγει από τη σελίδα με μη αποθηκευμένες αλλαγές.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = (tableId: number, patch: Partial<Edit>) => {
    if (!area) return;
    const aId = area.id;
    const orig = area.tables.find((t) => t.id === tableId);
    if (!orig) return;
    setEdits((prev) => {
      const cur = prev[aId]?.[tableId] ?? { posX: orig.posX, posY: orig.posY, shape: orig.shape };
      return { ...prev, [aId]: { ...prev[aId], [tableId]: { ...cur, ...patch } } };
    });
  };
  const clearEdits = (aId: number) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[aId];
      return next;
    });

  const save = () => {
    if (!area) return;
    const aId = area.id;
    const positions = tables.map((t) => ({ id: t.id, posX: t.posX, posY: t.posY, shape: t.shape }));
    run(() => saveTablePositionsAction(aId, positions), { success: "Ο χάρτης αποθηκεύτηκε", onSuccess: () => clearEdits(aId) });
  };

  const confirmDiscard = () => !dirty || window.confirm("Υπάρχουν μη αποθηκευμένες αλλαγές που θα χαθούν. Συνέχεια;");

  const autoLayout = (force: boolean) => {
    if (!area) return;
    if (force && !window.confirm("Θα τοποθετηθούν ΟΛΑ τα τραπέζια του χώρου σε πλέγμα και οι τρέχουσες θέσεις θα χαθούν. Συνέχεια;")) return;
    if (!confirmDiscard()) return;
    const aId = area.id;
    clearEdits(aId);
    run(() => autoLayoutAction(aId, force), {
      onSuccess: (n) => toast(n ? `Τοποθετήθηκαν ${n} τραπέζια` : "Όλα τα τραπέζια έχουν ήδη θέση"),
    });
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !area) return;
    if (!file.type.startsWith("image/")) return toast("Επίλεξε αρχείο εικόνας", "danger");
    if (file.size > MAX_UPLOAD) return toast("Η εικόνα πρέπει να είναι έως 3MB", "danger");
    const dims = await readImageSize(file);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("areaId", String(area.id));
    if (dims) {
      fd.set("width", String(dims.width));
      fd.set("height", String(dims.height));
    }
    run(() => uploadAreaMapAction(fd), { success: "Η εικόνα του χάρτη ενημερώθηκε" });
  };

  const removeImage = () => {
    if (!area || !window.confirm("Να αφαιρεθεί η εικόνα του χάρτη; Οι θέσεις των τραπεζιών διατηρούνται.")) return;
    const aId = area.id;
    run(() => removeAreaMapAction(aId), { success: "Η εικόνα αφαιρέθηκε" });
  };

  const nudge = (dx: number, dy: number) => {
    if (!selected || !isPlaced(selected)) return;
    edit(selected.id, { posX: clamp(selected.posX + dx), posY: clamp(selected.posY + dy) });
  };

  const markers: FloorMapTable[] = placedTables.map((t) => ({
    id: t.id,
    name: t.name,
    seats: t.seats,
    posX: t.posX,
    posY: t.posY,
    shape: t.shape,
    tone: "free",
    label: `${t.seats} θέσ.`,
  }));

  return (
    <div className="space-y-4">
      {toastElement}
      <PageHeader
        title="Χάρτης χώρου"
        subtitle={HELP}
        actions={
          <>
            {/* Πάντα στη ροή (αόρατο όταν δεν υπάρχουν αλλαγές) ώστε να μην μετακινείται ο χάρτης κατά το σύρσιμο. */}
            <span className={`self-center ${dirty ? "" : "invisible"}`} aria-hidden={!dirty}>
              <Badge tone="warn">Μη αποθηκευμένες αλλαγές</Badge>
            </span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => area && clearEdits(area.id)} disabled={!dirty || pending}>
              Επαναφορά
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!dirty || pending}>
              {pending ? "Αποθήκευση…" : "Αποθήκευση"}
            </button>
          </>
        }
      />

      {!area ? (
        <EmptyState title="Δεν υπάρχουν ενεργοί χώροι" hint="Δημιούργησε χώρους και τραπέζια από τη σελίδα «Τραπέζια»." />
      ) : (
        <>
          {areas.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 touch" role="tablist" aria-label="Χώροι">
              {areas.map((a) => {
                const active = a.id === area.id;
                const merged = mergeTables(a, edits[a.id]);
                const n = merged.filter(isPlaced).length;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setAreaId(a.id);
                      setSelectedId(null);
                    }}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold border transition ${
                      active ? "bg-brand text-white border-brand" : "bg-surface-2 text-ink-2 border-line hover:bg-surface-3"
                    }`}
                  >
                    {a.name}
                    <span className={`ml-1.5 num ${active ? "text-white/80" : "text-ink-3"}`}>
                      {n}/{merged.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
            <Section
              flush
              title={area.name}
              actions={
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => autoLayout(false)} disabled={pending}>
                    Αυτόματη διάταξη
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => autoLayout(true)} disabled={pending}>
                    Όλα σε πλέγμα
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={pending}>
                    Εικόνα χάρτη
                  </button>
                  {area.image && (
                    <button type="button" className="btn-ghost btn-sm text-danger" onClick={removeImage} disabled={pending}>
                      Αφαίρεση εικόνας
                    </button>
                  )}
                </>
              }
            >
              <div className="p-3 sm:p-4">
                <FloorMap areaImage={area.image} tables={markers} editable onMove={(id, x, y) => edit(id, { posX: x, posY: y })} onTap={setSelectedId} selectedId={selectedId} />
                <p className="text-xs text-ink-3 mt-2">
                  {area.image
                    ? `${placedTables.length} από ${tables.length} τραπέζια στον χάρτη · εικόνα έως 3MB (JPEG, PNG, WebP, SVG).`
                    : "Δεν υπάρχει εικόνα χάρτη. Ανέβασε μια φωτογραφία ή κάτοψη με το κουμπί «Εικόνα χάρτη» (έως 3MB)."}
                </p>
              </div>
            </Section>

            <aside className="space-y-4">
              <Section title="Επιλεγμένο τραπέζι">
                {selected ? (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-2xl font-bold">{selected.name}</span>
                      <span className="text-sm text-ink-3 num">{selected.seats} θέσεις</span>
                    </div>
                    <Field label="Σχήμα">
                      <select className="input" value={selected.shape} onChange={(e) => edit(selected.id, { shape: e.target.value as TableShape })}>
                        {SHAPES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {isPlaced(selected) ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-ink-3 num">
                            Θέση {(selected.posX / 10).toFixed(1)}% × {(selected.posY / 10).toFixed(1)}%
                          </span>
                          <div className="grid grid-cols-3 gap-1 touch" aria-label="Μετακίνηση">
                            <span />
                            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => nudge(0, -NUDGE)} aria-label="Πάνω">
                              ↑
                            </button>
                            <span />
                            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => nudge(-NUDGE, 0)} aria-label="Αριστερά">
                              ←
                            </button>
                            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => nudge(0, NUDGE)} aria-label="Κάτω">
                              ↓
                            </button>
                            <button type="button" className="btn-secondary btn-sm px-2" onClick={() => nudge(NUDGE, 0)} aria-label="Δεξιά">
                              →
                            </button>
                          </div>
                        </div>
                        <button type="button" className="btn-secondary btn-sm w-full" onClick={() => edit(selected.id, { posX: null, posY: null })}>
                          Αφαίρεση από τον χάρτη
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-primary btn-sm w-full" onClick={() => edit(selected.id, { posX: 500, posY: 500 })}>
                        Τοποθέτηση στον χάρτη
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">Πάτησε ένα τραπέζι στον χάρτη για να αλλάξεις σχήμα ή να το αφαιρέσεις. Σύρε το για να το μετακινήσεις.</p>
                )}
              </Section>

              <Section title={`Μη τοποθετημένα (${unplaced.length})`}>
                {unplaced.length ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {unplaced.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`btn-secondary btn-sm ${selectedId === t.id ? "ring-2 ring-brand" : ""}`}
                          onClick={() => {
                            edit(t.id, { posX: 500, posY: 500 });
                            setSelectedId(t.id);
                          }}
                        >
                          {t.name}
                          <span className="text-xs text-ink-3 num">{t.seats} θ.</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-ink-3 mt-2">Πάτησε ένα τραπέζι για να μπει στο κέντρο του χάρτη και μετά σύρε το στη θέση του.</p>
                  </>
                ) : (
                  <p className="text-sm text-ink-3">Όλα τα τραπέζια έχουν θέση στον χάρτη.</p>
                )}
              </Section>
            </aside>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} aria-label="Εικόνα χάρτη" />
    </div>
  );
}
