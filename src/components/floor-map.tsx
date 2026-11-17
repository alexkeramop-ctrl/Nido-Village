"use client";
/**
 * Χάρτης χώρου: απλή κάτοψη (χαρτί με πλέγμα και δωμάτια) ή προαιρετικά εικόνα φόντου,
 * με τα τραπέζια ως μαρκαδόρους σε θέσεις χιλιοστών (0–1000).
 * Κοινός για το PDA (μόνο ανάγνωση, tap) και τη Διαχείριση (σύρσιμο, επιλογή, σχεδίαση δωματίων).
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { TableShape } from "@/db/schema";
import { MIN_ROOM_SIZE, PLAN_ASPECT, clampRoomRect, roomColor, type PlanRoom } from "@/lib/floor-plan";

export type FloorMapTone = "free" | "open" | "billed";
export type FloorMapImage = { url: string; width: number | null; height: number | null } | null;
export type FloorMapTable = {
  id: number;
  name: string;
  seats: number;
  posX: number;
  posY: number;
  shape: TableShape;
  tone: FloorMapTone;
  /** Μικρή γραμμή κάτω από το όνομα (π.χ. θέσεις ή λεπτά). */
  label?: string;
  /** Δεύτερη μικρή γραμμή (π.χ. σύνολο) – κρύβεται σε πολύ μικρούς μαρκαδόρους. */
  sub?: string;
};

export type Placed<T extends { posX: number | null; posY: number | null }> = T & { posX: number; posY: number };
/** Type guard: το τραπέζι έχει θέση στον χάρτη. */
export function isPlaced<T extends { posX: number | null; posY: number | null }>(t: T): t is Placed<T> {
  return t.posX !== null && t.posY !== null;
}

type Props = {
  areaImage: FloorMapImage;
  tables: FloorMapTable[];
  onTap?: (id: number) => void;
  editable?: boolean;
  onMove?: (id: number, posX: number, posY: number) => void;
  selectedId?: number | null;
  /** Μέγιστο πλάτος σε px (προεπιλογή 900). */
  maxWidth?: number;
  /** Πλάτος μαρκαδόρου ως % του πλάτους του χάρτη. Χωρίς τιμή: αυτόματα από την πυκνότητα των τραπεζιών. */
  markerPct?: number;
  className?: string;
  /** Δωμάτια της κάτοψης, πίσω από τα τραπέζια. Εμφανίζονται μόνο όταν δεν υπάρχει εικόνα φόντου. */
  rooms?: PlanRoom[];
  /** Διαχείριση: τα δωμάτια σύρονται, αλλάζουν μέγεθος και σχεδιάζονται με σύρσιμο σε κενό σημείο (ποντίκι/γραφίδα). */
  roomsEditable?: boolean;
  selectedRoomId?: string | null;
  onRoomSelect?: (id: string | null) => void;
  onRoomChange?: (id: string, rect: RoomRect) => void;
  onRoomDraw?: (rect: RoomRect) => void;
};

export type RoomRect = { x: number; y: number; w: number; h: number };
type RoomDrag = { mode: "move" | "resize"; id: string; pointerId: number; startX: number; startY: number; orig: RoomRect };
type DrawDrag = { pointerId: number; startX: number; startY: number; x0: number; y0: number };

const TONE: Record<FloorMapTone, string> = {
  free: "bg-surface-2 border-line text-ink",
  open: "bg-brand-soft border-brand text-brand-2",
  billed: "bg-warn-soft border-warn text-warn",
};

const clamp1000 = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
const DRAG_THRESHOLD = 4;
const NUDGE = 5;

type Drag = { id: number; pointerId: number; startX: number; startY: number; origX: number; origY: number; moved: boolean };

/**
 * Μέγεθος μαρκαδόρου (% πλάτους) ώστε να μην καλύπτονται τα γειτονικά τραπέζια:
 * 25ο εκατοστημόριο της απόστασης από τον πλησιέστερο γείτονα, μεταξύ 3,5% και 8%.
 */
export function autoMarkerPct(tables: FloorMapTable[], ratio: number) {
  if (tables.length < 2) return 8;
  const nearest: number[] = [];
  for (const a of tables) {
    let best = Infinity;
    for (const b of tables) {
      if (a === b) continue;
      const dx = (a.posX - b.posX) / 10;
      const dy = ((a.posY - b.posY) / 10) * ratio;
      best = Math.min(best, Math.hypot(dx, dy));
    }
    nearest.push(best);
  }
  nearest.sort((x, y) => x - y);
  const q = nearest[Math.floor((nearest.length - 1) * 0.25)];
  return Math.round(Math.max(3.5, Math.min(8, q * 0.95)) * 2) / 2;
}

export function FloorMap({
  areaImage,
  tables,
  onTap,
  editable = false,
  onMove,
  selectedId = null,
  maxWidth = 900,
  markerPct,
  className = "",
  rooms,
  roomsEditable = false,
  selectedRoomId = null,
  onRoomSelect,
  onRoomChange,
  onRoomDraw,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const roomDragRef = useRef<RoomDrag | null>(null);
  const drawRef = useRef<DrawDrag | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RoomRect | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // Λόγος πλευρών: πραγματικές διαστάσεις της εικόνας αν φορτώθηκε, αλλιώς τα μεταδεδομένα, αλλιώς ο σταθερός λόγος της κάτοψης (4:3).
  const w = natural?.w || areaImage?.width || PLAN_ASPECT.w;
  const h = natural?.h || areaImage?.height || PLAN_ASPECT.h;
  const planRooms = areaImage ? [] : (rooms ?? []);
  const canEditRooms = roomsEditable && !areaImage;
  const ratio = h / w;
  const autoPct = useMemo(() => autoMarkerPct(tables, ratio), [tables, ratio]);
  const pct = markerPct ?? autoPct;
  const size = `clamp(34px, ${pct}cqw, 88px)`;
  const wideSize = `clamp(68px, ${pct * 2}cqw, 176px)`;

  const move = (id: number, x: number, y: number) => onMove?.(id, clamp1000(x), clamp1000(y));

  const onPointerDown = (t: FloorMapTable) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editable) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: t.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: t.posX, origY: t.posY, moved: false };
    onTap?.(t.id);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    const box = boxRef.current;
    if (!d || d.pointerId !== e.pointerId || !box) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDraggingId(d.id);
    }
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    move(d.id, d.origX + (dx / rect.width) * 1000, d.origY + (dy / rect.height) * 1000);
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (t: FloorMapTable) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!editable) return;
    const step = e.shiftKey ? NUDGE * 4 : NUDGE;
    const delta: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    move(t.id, t.posX + d[0], t.posY + d[1]);
  };

  /* ----------------------------- Δωμάτια (κάτοψη) ----------------------------- */

  const boxRect = () => {
    const r = boxRef.current?.getBoundingClientRect();
    return r && r.width && r.height ? r : null;
  };

  const onRoomPointerDown = (room: PlanRoom, mode: RoomDrag["mode"]) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!canEditRooms) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    // Αφή: το πρώτο άγγιγμα μόνο επιλέγει (ώστε η σελίδα να κυλά κανονικά πάνω από τα δωμάτια)· το επιλεγμένο δωμάτιο σύρεται.
    if (mode === "move" && e.pointerType === "touch" && selectedRoomId !== room.id) {
      onRoomSelect?.(room.id);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    roomDragRef.current = { mode, id: room.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, orig: { x: room.x, y: room.y, w: room.w, h: room.h } };
    if (selectedRoomId !== room.id) onRoomSelect?.(room.id);
  };
  const onRoomPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = roomDragRef.current;
    const rect = boxRect();
    if (!d || d.pointerId !== e.pointerId || !rect) return;
    e.stopPropagation();
    const dx = ((e.clientX - d.startX) / rect.width) * 1000;
    const dy = ((e.clientY - d.startY) / rect.height) * 1000;
    if (d.mode === "move") onRoomChange?.(d.id, clampRoomRect({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }));
    else
      onRoomChange?.(d.id, {
        x: d.orig.x,
        y: d.orig.y,
        w: Math.round(Math.max(MIN_ROOM_SIZE, Math.min(1000 - d.orig.x, d.orig.w + dx))),
        h: Math.round(Math.max(MIN_ROOM_SIZE, Math.min(1000 - d.orig.y, d.orig.h + dy))),
      });
  };
  const onRoomPointerEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const d = roomDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    roomDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onRoomKeyDown = (room: PlanRoom) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!canEditRooms || e.target !== e.currentTarget) return;
    const step = NUDGE * 2;
    const delta: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    const d = delta[e.key];
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRoomSelect?.(room.id);
      return;
    }
    if (!d) return;
    e.preventDefault();
    // Βελάκια: μετακίνηση. Shift + βελάκια: αλλαγή μεγέθους.
    if (e.shiftKey) onRoomChange?.(room.id, clampRoomRect({ x: room.x, y: room.y, w: Math.min(1000 - room.x, room.w + d[0]), h: Math.min(1000 - room.y, room.h + d[1]) }));
    else onRoomChange?.(room.id, clampRoomRect({ ...room, x: room.x + d[0], y: room.y + d[1] }));
  };

  // Σχεδίαση νέου δωματίου με σύρσιμο σε κενό σημείο (μόνο ποντίκι/γραφίδα· με αφή το σύρσιμο κυλά τη σελίδα).
  const draftOf = (d: DrawDrag, e: ReactPointerEvent<HTMLElement>, rect: DOMRect): RoomRect => {
    const x1 = clamp1000(d.x0 + ((e.clientX - d.startX) / rect.width) * 1000);
    const y1 = clamp1000(d.y0 + ((e.clientY - d.startY) / rect.height) * 1000);
    return { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
  };
  const onBoxPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canEditRooms || !onRoomDraw || e.target !== e.currentTarget) return;
    if (e.pointerType === "touch" || (e.pointerType === "mouse" && e.button !== 0)) return;
    const rect = boxRect();
    if (!rect) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x0: clamp1000(((e.clientX - rect.left) / rect.width) * 1000),
      y0: clamp1000(((e.clientY - rect.top) / rect.height) * 1000),
    };
  };
  const onBoxPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drawRef.current;
    const rect = boxRect();
    if (!d || d.pointerId !== e.pointerId || !rect) return;
    if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD && !draft) return;
    setDraft(draftOf(d, e, rect));
  };
  const onBoxPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drawRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const rect = boxRect();
    const r = draft && rect && e.type !== "pointercancel" ? draftOf(d, e, rect) : null;
    setDraft(null);
    if (r && r.w >= MIN_ROOM_SIZE && r.h >= MIN_ROOM_SIZE) {
      suppressClickRef.current = true;
      onRoomDraw?.(clampRoomRect(r));
    }
  };
  const onBoxClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canEditRooms || e.target !== e.currentTarget) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onRoomSelect?.(null);
  };

  const roomLabelSize = "clamp(10px, 2.3cqw, 20px)";

  return (
    <div
      ref={boxRef}
      data-floor-plan={areaImage ? "photo" : "plan"}
      onPointerDown={canEditRooms ? onBoxPointerDown : undefined}
      onPointerMove={canEditRooms ? onBoxPointerMove : undefined}
      onPointerUp={canEditRooms ? onBoxPointerEnd : undefined}
      onPointerCancel={canEditRooms ? onBoxPointerEnd : undefined}
      onClick={canEditRooms ? onBoxClick : undefined}
      className={`@container relative w-full mx-auto overflow-hidden rounded-xl border select-none ${areaImage ? "border-line bg-surface-3" : "border-[#d9d5c7] bg-[#fcfbf7]"} ${
        canEditRooms && onRoomDraw ? "cursor-crosshair" : ""
      } ${className}`}
      style={{
        maxWidth,
        aspectRatio: `${w} / ${h}`,
        ...(areaImage
          ? {}
          : {
              // Χαρτί με λεπτό πλέγμα (κάθε 5%), πιο έντονη γραμμή κάθε 25%.
              backgroundImage:
                "linear-gradient(to right, rgba(31,42,34,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(31,42,34,0.10) 1px, transparent 1px), linear-gradient(to right, rgba(31,42,34,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(31,42,34,0.05) 1px, transparent 1px)",
              backgroundSize: "25% 25%, 25% 25%, 5% 5%, 5% 5%",
            }),
      }}
    >
      {planRooms.map((r) => {
        const c = roomColor(r.color);
        const selected = canEditRooms && r.id === selectedRoomId;
        const box = { left: `${r.x / 10}%`, top: `${r.y / 10}%`, width: `${r.w / 10}%`, height: `${r.h / 10}%`, backgroundColor: c.fill, borderColor: c.stroke };
        const label = (
          <span
            className="pointer-events-none absolute left-[0.5em] top-[0.3em] right-[0.5em] truncate font-semibold leading-tight"
            style={{ fontSize: roomLabelSize, color: c.stroke, filter: "brightness(0.62)" }}
          >
            {r.name}
          </span>
        );
        if (!canEditRooms)
          return (
            <div key={r.id} data-room-id={r.id} data-room-name={r.name} className="pointer-events-none absolute z-0 rounded-[1.2cqw] border-2" style={box}>
              {label}
            </div>
          );
        return (
          <Fragment key={r.id}>
            <div
              role="button"
              tabIndex={0}
              data-room-id={r.id}
              data-room-name={r.name}
              aria-label={`Δωμάτιο ${r.name}`}
              aria-pressed={selected}
              onPointerDown={onRoomPointerDown(r, "move")}
              onPointerMove={onRoomPointerMove}
              onPointerUp={onRoomPointerEnd}
              onPointerCancel={onRoomPointerEnd}
              onKeyDown={onRoomKeyDown(r)}
              className={`absolute rounded-[1.2cqw] border-2 cursor-move outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                selected ? "z-[5] ring-2 ring-brand ring-offset-1 ring-offset-white shadow-md" : "z-0"
              }`}
              style={{ ...box, touchAction: selected ? "none" : "auto" }}
            >
              {label}
            </div>
            {/* Λαβή αλλαγής μεγέθους στην κάτω δεξιά γωνία (αδελφό στοιχείο, όχι μέσα στο δωμάτιο).
                Έως 32px αλλά ποτέ πάνω από το 45% του δωματίου, ώστε και ένα μικρό δωμάτιο να πιάνεται για μετακίνηση. */}
            <button
              type="button"
              data-room-resize={r.id}
              aria-label={`Αλλαγή μεγέθους: ${r.name}`}
              title="Σύρε για αλλαγή μεγέθους"
              onPointerDown={onRoomPointerDown(r, "resize")}
              onPointerMove={onRoomPointerMove}
              onPointerUp={onRoomPointerEnd}
              onPointerCancel={onRoomPointerEnd}
              className={`absolute flex items-end justify-end cursor-nwse-resize outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md ${selected ? "z-[7]" : "z-[1]"}`}
              style={{
                left: `${(r.x + r.w) / 10}%`,
                top: `${(r.y + r.h) / 10}%`,
                width: `min(32px, ${r.w * 0.045}%)`,
                height: `min(32px, ${r.h * 0.045}%)`,
                transform: "translate(-100%, -100%)",
                touchAction: "none",
              }}
            >
              <span aria-hidden className="mb-0.5 mr-0.5 block h-3.5 w-3.5 shrink-0 rounded-[3px] border-2 border-white shadow" style={{ backgroundColor: c.stroke }} />
            </button>
          </Fragment>
        );
      })}
      {draft && <div className="pointer-events-none absolute z-[6] rounded-[1.2cqw] border-2 border-dashed border-brand bg-brand-soft" style={{ left: `${draft.x / 10}%`, top: `${draft.y / 10}%`, width: `${draft.w / 10}%`, height: `${draft.h / 10}%` }} />}
      {areaImage && (
        // eslint-disable-next-line @next/next/no-img-element -- εικόνα από τη βάση, χωρίς γνωστές διαστάσεις για next/image
        <img
          src={areaImage.url}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          className="absolute inset-0 h-full w-full object-fill pointer-events-none"
        />
      )}
      {tables.map((t) => {
        const selected = t.id === selectedId;
        const dragging = t.id === draggingId;
        const wide = t.shape === "wide";
        const shapeCls = t.shape === "round" ? "rounded-full" : "rounded-[18%]";
        const nameScale = t.name.length <= 3 ? 1 : Math.max(0.6, 3 / t.name.length);
        return (
          <button
            key={t.id}
            type="button"
            data-table-id={t.id}
            data-table-name={t.name}
            aria-label={t.label ? `${t.name}, ${t.label}` : t.name}
            aria-pressed={editable ? selected : undefined}
            onClick={editable ? undefined : () => onTap?.(t.id)}
            onPointerDown={onPointerDown(t)}
            onPointerMove={editable ? onPointerMove : undefined}
            onPointerUp={editable ? onPointerEnd : undefined}
            onPointerCancel={editable ? onPointerEnd : undefined}
            onKeyDown={onKeyDown(t)}
            className={`@container absolute flex flex-col items-center justify-center overflow-hidden border-2 px-0.5 py-0.5 leading-none shadow-md transition-[box-shadow,transform] ${shapeCls} ${TONE[t.tone]} ${
              selected ? "z-20 ring-2 ring-brand ring-offset-2 ring-offset-white" : "z-10"
            } ${dragging ? "scale-110 shadow-xl cursor-grabbing" : editable ? "cursor-grab" : "cursor-pointer active:scale-95"}`}
            style={{
              left: `${t.posX / 10}%`,
              top: `${t.posY / 10}%`,
              width: wide ? wideSize : size,
              aspectRatio: wide ? "2 / 1" : "1 / 1",
              transform: `translate(-50%, -50%)${dragging ? " scale(1.1)" : ""}`,
              touchAction: editable ? "none" : "manipulation",
            }}
          >
            {/* Χωρίς αποσιωπητικά: μικρά ονόματα (Κ12) χωρούν στον κύκλο· τα πολύ μακριά σμικρύνονται και κόβονται στην άκρη. */}
            <span className="font-bold whitespace-nowrap" style={{ fontSize: `clamp(10px, ${(wide ? 17 : 34) * nameScale}cqw, 24px)` }}>
              {t.name}
            </span>
            {t.label && (
              <span className="truncate max-w-full num opacity-80 mt-[0.15em]" style={{ fontSize: `clamp(8px, ${wide ? 10 : 20}cqw, 13px)` }}>
                {t.label}
              </span>
            )}
            {t.sub && (
              <span className="truncate max-w-full num font-semibold @max-[32px]:hidden" style={{ fontSize: `clamp(8px, ${wide ? 11 : 22}cqw, 14px)` }}>
                {t.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------- Χάρτης με ζουμ και κύλιση ------------------------- */

const ZOOMS = [1, 1.5, 2, 2.5, 3];
/** Ελάχιστο «φυσικό» πλάτος μαρκαδόρου (px) που επιδιώκει το αυτόματο ζουμ. */
const MIN_MARKER_PX = 30;

/**
 * Τυλίγει τον FloorMap σε οριζόντια κυλιόμενο πλαίσιο με κουμπιά ζουμ.
 * Το αρχικό ζουμ επιλέγεται αυτόματα ώστε οι μαρκαδόροι να μένουν ευανάγνωστοι και διακριτοί
 * (π.χ. σε κινητό, όπου ο χάρτης είναι στενός) και ο χάρτης κυλά στο κέντρο των τραπεζιών.
 */
export function ZoomableFloorMap({ footer, ...props }: Props & { footer?: ReactNode }) {
  const { tables, areaImage, maxWidth = 900, markerPct } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const tablesRef = useRef(tables);
  const [wrapWidth, setWrapWidth] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null); // null = αυτόματο

  useEffect(() => {
    tablesRef.current = tables;
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWrapWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ratio = (areaImage?.height || 3) / (areaImage?.width || 4);
  const pct = markerPct ?? autoMarkerPct(tables, ratio);
  const autoZoom = useMemo(() => {
    if (!wrapWidth) return 1;
    for (const z of ZOOMS) if ((pct / 100) * Math.min(wrapWidth, maxWidth) * z >= MIN_MARKER_PX) return z;
    return ZOOMS[ZOOMS.length - 1];
  }, [wrapWidth, pct, maxWidth]);
  const z = zoom ?? autoZoom;
  const tablesKey = tables.map((t) => t.id).join(",");

  // Στο αυτόματο ζουμ: οριζόντια κύλιση ώστε να φαίνεται το κέντρο των τραπεζιών.
  useEffect(() => {
    const el = wrapRef.current;
    const list = tablesRef.current;
    if (!el || zoom !== null || z === 1 || !list.length) return;
    const cx = list.reduce((s, t) => s + t.posX, 0) / list.length / 1000;
    el.scrollLeft = Math.max(0, cx * el.scrollWidth - el.clientWidth / 2);
  }, [z, zoom, tablesKey]);

  const step = (dir: 1 | -1) => setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + dir))]);

  return (
    <div>
      <div ref={wrapRef} className="w-full overflow-x-auto overflow-y-hidden">
        <div style={{ width: `${z * 100}%` }} className="min-w-full">
          <FloorMap {...props} maxWidth={maxWidth * z} markerPct={pct} />
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 mt-2">
        <div className="min-w-0 text-xs text-ink-3">{footer}</div>
        <div className="inline-flex items-center gap-1 shrink-0 touch" role="group" aria-label="Ζουμ χάρτη">
          <button type="button" className="btn-secondary btn-sm px-3" onClick={() => step(-1)} disabled={z === ZOOMS[0]} aria-label="Σμίκρυνση">
            −
          </button>
          <span className="text-xs text-ink-3 num w-9 text-center">{z}×</span>
          <button type="button" className="btn-secondary btn-sm px-3" onClick={() => step(1)} disabled={z === ZOOMS[ZOOMS.length - 1]} aria-label="Μεγέθυνση">
            +
          </button>
        </div>
      </div>
    </div>
  );
}
