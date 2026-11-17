"use client";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Badge, Field } from "@/components/ui";
import { FormModal, InfoBox, PageHeader, Section, formValues, useActionRunner } from "@/components/admin/common";
import { ZoomableFloorMap, isPlaced, type FloorMapImage, type FloorMapTable, type RoomRect } from "@/components/floor-map";
import type { TableShape } from "@/db/schema";
import { DEFAULT_ROOM_COLOR, FIXTURES, MAX_ROOMS, MAX_ROOM_NAME, ROOM_COLORS, fixtureOf, newRoomId, nextFixture, nextRoom, samePlan, type FixtureKind, type PlanRoom } from "@/lib/floor-plan";
import { DEFAULT_ROOM_COLS, DEFAULT_ROOM_TABLES, MAX_ROOM_COLS, MAX_ROOM_TABLES, ROOM_PRESET, defaultPrefix } from "@/lib/floor-rooms";
import { addTableAction, autoLayoutAction, createRoomAction, createRoomPresetAction, removeAreaMapAction, removeRoomAction, removeTableAction, saveFloorLayoutAction, uploadAreaMapAction } from "./actions";

export type EditorTable = { id: number; name: string; seats: number; posX: number | null; posY: number | null; shape: TableShape };
export type EditorArea = { id: number; name: string; image: FloorMapImage; rooms: PlanRoom[]; tables: EditorTable[] };

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
const HELP = "Κάθε δωμάτιο έχει τη δική του κάτοψη. Σύρε τα τραπέζια για να αλλάξεις τη διάταξη, πρόσθεσε τραπέζια και στοιχεία χώρου (μπαρ, τζάκι, κουζίνα) και πάτα «Αποθήκευση».";
const PRESET_LABEL = ROOM_PRESET.map((r) => r.name).join(", ");

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
  /** Μη αποθηκευμένα δωμάτια ανά χώρο (ολόκληρη η λίστα του χώρου). */
  const [planEdits, setPlanEdits] = useState<Record<number, PlanRoom[]>>({});
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [roomModal, setRoomModal] = useState(false);
  const [roomName, setRoomName] = useState("");

  const area = areas.find((a) => a.id === areaId) ?? areas[0] ?? null;
  const areaEdits = area ? edits[area.id] : undefined;
  const tables = useMemo(() => (area ? mergeTables(area, areaEdits) : []), [area, areaEdits]);
  const tablesDirty = useMemo(
    () =>
      !!area &&
      area.tables.some((o) => {
        const e = areaEdits?.[o.id];
        return !!e && (e.posX !== o.posX || e.posY !== o.posY || e.shape !== o.shape);
      }),
    [area, areaEdits],
  );
  const areaPlanEdit = area ? planEdits[area.id] : undefined;
  const rooms = useMemo(() => areaPlanEdit ?? area?.rooms ?? [], [areaPlanEdit, area]);
  const planDirty = !!area && !!areaPlanEdit && !samePlan(areaPlanEdit, area.rooms);
  const dirty = tablesDirty || planDirty;
  /** Με φωτογραφία φόντου τα δωμάτια δεν σχεδιάζονται (άλλος λόγος πλευρών)· η απλή κάτοψη είναι η κύρια λειτουργία. */
  const planMode = !!area && !area.image;
  const selectedRoom = planMode ? (rooms.find((r) => r.id === selectedRoomId) ?? null) : null;
  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const placedTables = tables.filter(isPlaced);
  const unplaced = tables.filter((t) => !isPlaced(t));

  /** Χώροι με μη αποθηκευμένες αλλαγές (και όσοι δεν είναι ο επιλεγμένος): για την προειδοποίηση εξόδου και την ένδειξη στις καρτέλες. */
  const dirtyAreaIds = useMemo(() => {
    const ids = new Set<number>();
    for (const a of areas) {
      const e = edits[a.id];
      const p = planEdits[a.id];
      const t = !!e && a.tables.some((o) => !!e[o.id] && (e[o.id].posX !== o.posX || e[o.id].posY !== o.posY || e[o.id].shape !== o.shape));
      if (t || (!!p && !samePlan(p, a.rooms))) ids.add(a.id);
    }
    return ids;
  }, [areas, edits, planEdits]);
  const anyDirty = dirtyAreaIds.size > 0;
  const otherDirty = areas.filter((a) => a.id !== area?.id && dirtyAreaIds.has(a.id));

  // Προειδοποίηση αν φύγει από τη σελίδα με μη αποθηκευμένες αλλαγές (σε οποιονδήποτε χώρο).
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

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

  const clearPlanEdits = (aId: number) =>
    setPlanEdits((prev) => {
      const next = { ...prev };
      delete next[aId];
      return next;
    });

  /* --------------------------------- Δωμάτια --------------------------------- */

  const setRooms = (fn: (cur: PlanRoom[]) => PlanRoom[]) => {
    if (!area) return;
    const aId = area.id;
    const base = area.rooms;
    setPlanEdits((prev) => ({ ...prev, [aId]: fn(prev[aId] ?? base) }));
  };
  const selectRoom = (id: string | null) => {
    setSelectedRoomId(id);
    if (id !== null) setSelectedId(null);
  };
  const selectTable = (id: number | null) => {
    setSelectedId(id);
    if (id !== null) setSelectedRoomId(null);
  };
  const patchRoom = (id: string, patch: Partial<PlanRoom>) => setRooms((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRoom = (rect?: RoomRect) => {
    if (rooms.length >= MAX_ROOMS) return toast(`Έως ${MAX_ROOMS} στοιχεία ανά δωμάτιο`, "danger");
    const room = { ...nextRoom(rooms), ...rect, id: newRoomId() };
    setRooms((cur) => [...cur, room]);
    selectRoom(room.id);
  };

  /* ------------------------ Δωμάτια (χώροι) και τραπέζια ------------------------ */

  const openRoomModal = () => {
    setRoomName("");
    setRoomModal(true);
  };
  const createPreset = () => {
    run(() => createRoomPresetAction(), {
      onSuccess: (r) => {
        setRoomModal(false);
        toast(r.created.length ? `Δημιουργήθηκαν: ${r.created.join(", ")} (20 τραπέζια το καθένα)` : "Τα τρία δωμάτια υπάρχουν ήδη");
      },
    });
  };
  const submitRoom = (fd: FormData) => {
    const v = formValues(fd);
    run(() => createRoomAction({ name: v.str("name"), count: v.int("count"), cols: v.int("cols"), prefix: v.str("prefix") || undefined, seats: v.int("seats", 4) }), {
      onSuccess: (r) => {
        setRoomModal(false);
        setAreaId(r.areaId);
        setSelectedId(null);
        setSelectedRoomId(null);
        toast(`Το δωμάτιο δημιουργήθηκε με ${r.tables} τραπέζια`);
      },
    });
  };
  const removeRoom = () => {
    if (!area) return;
    const a = area;
    const msg = a.tables.length ? `Να αφαιρεθεί το δωμάτιο «${a.name}» μαζί με τα ${a.tables.length} τραπέζια του;` : `Να αφαιρεθεί το δωμάτιο «${a.name}»;`;
    if (!window.confirm(msg)) return;
    run(() => removeRoomAction(a.id), {
      onSuccess: () => {
        clearEdits(a.id);
        clearPlanEdits(a.id);
        setAreaId(areas.find((x) => x.id !== a.id)?.id ?? null);
        setSelectedId(null);
        setSelectedRoomId(null);
        toast(`Το δωμάτιο «${a.name}» αφαιρέθηκε`);
      },
    });
  };
  const addTable = () => {
    if (!area) return;
    const aId = area.id;
    run(() => addTableAction(aId), {
      onSuccess: (t) => {
        selectTable(t.id);
        toast(`Προστέθηκε το τραπέζι ${t.name}. Σύρε το στη θέση του.`);
      },
    });
  };
  const removeSelectedTable = () => {
    if (!selected) return;
    const t = selected;
    if (!window.confirm(`Να αφαιρεθεί το τραπέζι ${t.name};`)) return;
    run(() => removeTableAction(t.id), {
      onSuccess: (mode) => {
        setSelectedId(null);
        toast(mode === "archived" ? `Το ${t.name} κρύφτηκε (έχει ιστορικό πωλήσεων, οι αναφορές μένουν σωστές)` : `Το τραπέζι ${t.name} αφαιρέθηκε`);
      },
    });
  };
  /** Έτοιμο στοιχείο χώρου (μπαρ, τζάκι, κουζίνα…) ή γενική ζώνη με kind = "". */
  const addFixture = (kind: FixtureKind | "") => {
    if (!kind) return addRoom();
    if (rooms.length >= MAX_ROOMS) return toast(`Έως ${MAX_ROOMS} στοιχεία ανά δωμάτιο`, "danger");
    const item = nextFixture(rooms, kind);
    setRooms((cur) => [...cur, item]);
    selectRoom(item.id);
  };
  const deleteRoom = (id: string) => {
    setRooms((cur) => cur.filter((r) => r.id !== id));
    setSelectedRoomId(null);
  };

  const save = () => {
    if (!area) return;
    const aId = area.id;
    const positions = tables.map((t) => ({ id: t.id, posX: t.posX, posY: t.posY, shape: t.shape }));
    // Ό,τι στάλθηκε: αν ο χρήστης αλλάξει κάτι όσο διαρκεί η αποθήκευση, οι νεότερες αλλαγές ΔΕΝ πετιούνται (ο χώρος μένει «μη αποθηκευμένος»).
    const sentEdits = edits[aId];
    const sentPlan = planEdits[aId];
    run(() => saveFloorLayoutAction(aId, positions, { rooms }), {
      success: "Η κάτοψη αποθηκεύτηκε",
      onSuccess: () => {
        setEdits((prev) => {
          if (prev[aId] !== sentEdits) return prev;
          const next = { ...prev };
          delete next[aId];
          return next;
        });
        setPlanEdits((prev) => {
          if (prev[aId] !== sentPlan) return prev;
          const next = { ...prev };
          delete next[aId];
          return next;
        });
      },
    });
  };
  const reset = () => {
    if (!area) return;
    clearEdits(area.id);
    clearPlanEdits(area.id);
    setSelectedRoomId(null);
  };

  const confirmDiscard = () => !tablesDirty || window.confirm("Υπάρχουν μη αποθηκευμένες αλλαγές στις θέσεις των τραπεζιών που θα χαθούν. Συνέχεια;");

  const autoLayout = (force: boolean) => {
    if (!area) return;
    if (force && !window.confirm("Θα τοποθετηθούν ΟΛΑ τα τραπέζια του δωματίου σε πλέγμα και οι τρέχουσες θέσεις θα χαθούν. Συνέχεια;")) return;
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
    run(() => uploadAreaMapAction(fd), { success: "Η φωτογραφία φόντου ενημερώθηκε" });
  };

  const removeImage = () => {
    if (!area || !window.confirm("Να αφαιρεθεί η φωτογραφία φόντου; Οι θέσεις των τραπεζιών διατηρούνται.")) return;
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
        title="Κάτοψη χώρου"
        subtitle={HELP}
        actions={
          area && (
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={reset} disabled={!dirty || pending}>
              Επαναφορά
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!dirty || pending}>
              {pending ? "Αποθήκευση…" : "Αποθήκευση"}
            </button>
          </>
          )
        }
      />

      {!area ? (
        <div className="card p-8 text-center text-ink-3">
          <div className="text-lg font-medium text-ink-2">Δεν υπάρχουν δωμάτια ακόμα</div>
          <div className="text-sm mt-1 max-w-xl mx-auto">
            Ξεκίνα με τα τρία έτοιμα δωμάτια ({PRESET_LABEL}): το καθένα έχει 20 τραπέζια σε 4 σειρές των 5. Μετά αλλάζεις τη διάταξη σύροντας, και προσθέτεις ή αφαιρείς τραπέζια.
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={createPreset} disabled={pending}>
              Δημιουργία 3 δωματίων × 20 τραπέζια
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={openRoomModal} disabled={pending}>
              + Δωμάτιο
            </button>
          </div>
        </div>
      ) : (
        <>
          {areas.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 touch" role="tablist" aria-label="Δωμάτια">
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
                      setSelectedRoomId(null);
                    }}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold border transition ${
                      active ? "bg-brand text-white border-brand" : "bg-surface-2 text-ink-2 border-line hover:bg-surface-3"
                    }`}
                  >
                    {a.name}
                    {dirtyAreaIds.has(a.id) && (
                      <span data-unsaved-dot className={`ml-1.5 inline-block h-2 w-2 rounded-full align-middle ${active ? "bg-white" : "bg-warn"}`} role="img" aria-label="μη αποθηκευμένες αλλαγές" title="Μη αποθηκευμένες αλλαγές" />
                    )}
                    <span className={`ml-1.5 num ${active ? "text-white/80" : "text-ink-3"}`}>
                      {n}/{merged.length}
                    </span>
                  </button>
                );
              })}
              <button type="button" onClick={openRoomModal} disabled={pending} className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold border border-dashed border-line text-ink-2 hover:bg-surface-3">
                + Δωμάτιο
              </button>
            </div>
          )}

          {otherDirty.length > 0 && (
            <InfoBox tone="warn">
              Υπάρχουν μη αποθηκευμένες αλλαγές και {otherDirty.length === 1 ? "στο δωμάτιο" : "στα δωμάτια"} <b>{otherDirty.map((a) => `«${a.name}»`).join(", ")}</b>. Η «Αποθήκευση» αποθηκεύει μόνο το δωμάτιο που
              βλέπεις: άνοιξε {otherDirty.length === 1 ? "το" : "το καθένα"} και πάτησε «Αποθήκευση».
            </InfoBox>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
            <Section
              flush
              title={
                <span className="inline-flex items-center gap-2">
                  {area.name}
                  {/* Πάντα στη ροή (αόρατο όταν δεν υπάρχουν αλλαγές) ώστε να μην μετακινείται ο χάρτης κατά το σύρσιμο. */}
                  <span className={dirty ? "" : "invisible"} aria-hidden={!dirty}>
                    <Badge tone="warn">Μη αποθηκευμένες αλλαγές</Badge>
                  </span>
                </span>
              }
              actions={
                <>
                  <button type="button" className="btn-primary btn-sm" onClick={addTable} disabled={pending}>
                    + Τραπέζι
                  </button>
                  {tables.length > 0 && (
                    <>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => autoLayout(false)} disabled={pending}>
                        Αυτόματη διάταξη
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => autoLayout(true)} disabled={pending}>
                        Όλα σε πλέγμα
                      </button>
                    </>
                  )}
                  {planMode && (
                    <select
                      aria-label="Προσθήκη στοιχείου χώρου"
                      className="btn-secondary btn-sm cursor-pointer"
                      value=""
                      disabled={pending || rooms.length >= MAX_ROOMS}
                      onChange={(e) => addFixture(e.target.value === "zone" ? "" : (e.target.value as FixtureKind))}
                    >
                      <option value="" disabled>
                        + Στοιχείο χώρου…
                      </option>
                      {FIXTURES.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.icon} {f.label}
                        </option>
                      ))}
                      <option value="zone">▭ Άλλη ζώνη (ελεύθερο όνομα)</option>
                    </select>
                  )}
                  <button type="button" className="btn-ghost btn-sm text-danger" onClick={removeRoom} disabled={pending} aria-label={`Διαγραφή δωματίου ${area.name}`}>
                    Διαγραφή δωματίου
                  </button>
                </>
              }
            >
              <div className="p-3 sm:p-4 space-y-3">
                {tables.length === 0 && (
                  <InfoBox>
                    Το δωμάτιο «{area.name}» δεν έχει ακόμα τραπέζια. Πάτησε <b>«+ Τραπέζι»</b> για να προσθέσεις ένα ένα.
                  </InfoBox>
                )}
                <ZoomableFloorMap
                  key={area.id}
                  areaImage={area.image}
                  tables={markers}
                  editable
                  onMove={(id, x, y) => edit(id, { posX: x, posY: y })}
                  onTap={selectTable}
                  selectedId={selectedId}
                  rooms={rooms}
                  roomsEditable={planMode}
                  selectedRoomId={selectedRoomId}
                  onRoomSelect={selectRoom}
                  onRoomChange={(id, rect) => patchRoom(id, rect)}
                  onRoomDraw={(rect) => addRoom(rect)}
                  footer={
                    planMode
                      ? `${placedTables.length} από ${tables.length} τραπέζια στην κάτοψη. Σύρε ένα τραπέζι για να το μετακινήσεις.`
                      : `${placedTables.length} από ${tables.length} τραπέζια στον χάρτη.`
                  }
                />
              </div>
            </Section>

            <aside className="space-y-4">
              {planMode && (
                <Section title={`Στοιχεία χώρου (${rooms.length})`}>
                  {selectedRoom ? (
                    <div className="space-y-3">
                      <Field label="Είδος">
                        <select
                          className="input"
                          aria-label="Είδος στοιχείου"
                          value={selectedRoom.kind ?? ""}
                          onChange={(e) => {
                            const f = fixtureOf(e.target.value);
                            const old = fixtureOf(selectedRoom.kind);
                            // Αν το όνομα ήταν το προεπιλεγμένο του παλιού είδους, ακολουθεί το νέο.
                            const keepName = selectedRoom.name && selectedRoom.name !== old?.label;
                            patchRoom(selectedRoom.id, { kind: f?.key, ...(f && !keepName ? { name: f.label } : {}) });
                          }}
                        >
                          <option value="">▭ Ζώνη (χωρίς εικονίδιο)</option>
                          {FIXTURES.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.icon} {f.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Όνομα">
                        <input
                          className="input"
                          aria-label="Όνομα στοιχείου"
                          value={selectedRoom.name}
                          maxLength={MAX_ROOM_NAME}
                          onChange={(e) => patchRoom(selectedRoom.id, { name: e.target.value })}
                        />
                      </Field>
                      <div>
                        <span className="label">Χρώμα</span>
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Χρώμα στοιχείου">
                          {ROOM_COLORS.map((c) => {
                            const on = (selectedRoom.color ?? DEFAULT_ROOM_COLOR) === c.key;
                            return (
                              <button
                                key={c.key}
                                type="button"
                                aria-label={`Χρώμα: ${c.label}`}
                                aria-pressed={on}
                                title={c.label}
                                onClick={() => patchRoom(selectedRoom.id, { color: c.key })}
                                className={`h-9 w-9 rounded-full border-2 transition ${on ? "ring-2 ring-brand ring-offset-2 ring-offset-white" : ""}`}
                                style={{ backgroundColor: c.fill, borderColor: c.stroke }}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div className="text-xs text-ink-3 num">
                        Μέγεθος {(selectedRoom.w / 10).toFixed(0)}% × {(selectedRoom.h / 10).toFixed(0)}% · σύρε το για μετακίνηση και τη γωνία κάτω δεξιά για μέγεθος.
                      </div>
                      <button type="button" className="btn-secondary btn-sm w-full text-danger" onClick={() => deleteRoom(selectedRoom.id)} aria-label={`Διαγραφή στοιχείου ${selectedRoom.name}`}>
                        Διαγραφή στοιχείου
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-ink-3">
                        {rooms.length
                          ? "Πάτησε ένα στοιχείο στο σχέδιο για να αλλάξεις όνομα, χρώμα, είδος ή να το διαγράψεις."
                          : "Δείξε πού είναι το μπαρ, το τζάκι, η κουζίνα ή η είσοδος, για να φαίνεται η διάταξη του δωματίου."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Προσθήκη στοιχείου">
                        {FIXTURES.map((f) => (
                          <button key={f.key} type="button" className="btn-secondary btn-sm" onClick={() => addFixture(f.key)} disabled={pending || rooms.length >= MAX_ROOMS} aria-label={`Προσθήκη: ${f.label}`}>
                            <span aria-hidden>{f.icon}</span>
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {rooms.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line" role="group" aria-label="Λίστα στοιχείων">
                      {rooms.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          aria-pressed={r.id === selectedRoomId}
                          onClick={() => selectRoom(r.id)}
                          className={`btn-secondary btn-sm max-w-full ${r.id === selectedRoomId ? "ring-2 ring-brand" : ""}`}
                        >
                          {fixtureOf(r.kind) && <span aria-hidden>{fixtureOf(r.kind)!.icon}</span>}
                          <span className="truncate">{r.name || "Χωρίς όνομα"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Section>
              )}

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
                    <button type="button" className="btn-secondary btn-sm w-full text-danger" onClick={removeSelectedTable} disabled={pending} aria-label={`Διαγραφή τραπεζιού ${selected.name}`}>
                      Διαγραφή τραπεζιού
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">Πάτησε ένα τραπέζι για να αλλάξεις σχήμα ή να το διαγράψεις. Σύρε το για να το μετακινήσεις.</p>
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
                            selectTable(t.id);
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
                  <p className="text-sm text-ink-3">{tables.length ? "Όλα τα τραπέζια έχουν θέση στον χάρτη." : "Δεν υπάρχουν τραπέζια σε αυτό το δωμάτιο."}</p>
                )}
              </Section>

              <Section title="Προαιρετικά: φωτογραφία φόντου">
                <p className="text-sm text-ink-3 mb-3">
                  {area.image
                    ? "Ο χάρτης δείχνει τη φωτογραφία. Αφαίρεσέ τη για να γυρίσεις στην απλή κάτοψη."
                    : "Δεν χρειάζεται. Αν θέλεις, ανέβασε μια φωτογραφία ή έτοιμο σχέδιο (έως 3MB) για να μπει πίσω από τα τραπέζια αντί για την κάτοψη."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={pending}>
                    {area.image ? "Αλλαγή φωτογραφίας" : "Ανέβασμα φωτογραφίας"}
                  </button>
                  {area.image && (
                    <button type="button" className="btn-ghost btn-sm text-danger" onClick={removeImage} disabled={pending}>
                      Αφαίρεση φωτογραφίας
                    </button>
                  )}
                </div>
              </Section>
            </aside>
          </div>
        </>
      )}

      <FormModal open={roomModal} onClose={() => setRoomModal(false)} title="Νέο δωμάτιο" onSubmit={submitRoom} pending={pending} submitLabel="Δημιουργία">
        <Field label="Όνομα δωματίου">
          <input name="name" className="input" required maxLength={40} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="π.χ. Παιδική" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Τραπέζια">
            <input name="count" type="number" inputMode="numeric" min={0} max={MAX_ROOM_TABLES} className="input num" defaultValue={DEFAULT_ROOM_TABLES} required />
          </Field>
          <Field label="Τραπέζια ανά σειρά" hint="π.χ. 20 τραπέζια, 5 ανά σειρά = 4 σειρές">
            <input name="cols" type="number" inputMode="numeric" min={1} max={MAX_ROOM_COLS} className="input num" defaultValue={DEFAULT_ROOM_COLS} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Πρόθεμα ονομάτων" hint={`Τα τραπέζια θα λέγονται ${roomName.trim() ? defaultPrefix(roomName) : "Π"}1, ${roomName.trim() ? defaultPrefix(roomName) : "Π"}2…`}>
            <input name="prefix" className="input" maxLength={4} placeholder={roomName.trim() ? defaultPrefix(roomName) : "Π"} />
          </Field>
          <Field label="Θέσεις ανά τραπέζι">
            <input name="seats" type="number" inputMode="numeric" min={1} max={30} className="input num" defaultValue={4} />
          </Field>
        </div>
        {ROOM_PRESET.some((r) => !areas.some((a) => a.name === r.name)) && (
          <InfoBox>
            Θέλεις έτοιμα τα τρία δωμάτια ({PRESET_LABEL}) με 20 τραπέζια το καθένα;{" "}
            <button type="button" className="font-semibold underline" onClick={createPreset} disabled={pending}>
              Δημιούργησέ τα με ένα κλικ
            </button>
            .
          </InfoBox>
        )}
      </FormModal>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} aria-label="Φωτογραφία φόντου" />
    </div>
  );
}
