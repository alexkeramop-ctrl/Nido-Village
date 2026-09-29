"use client";
/**
 * Χάρτης χώρου: εικόνα φόντου (ή πλέγμα) με τα τραπέζια ως μαρκαδόρους σε θέσεις χιλιοστών (0–1000).
 * Κοινός για το PDA (μόνο ανάγνωση, tap) και τη Διαχείριση (σύρσιμο, επιλογή).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { TableShape } from "@/db/schema";

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
};

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

export function FloorMap({ areaImage, tables, onTap, editable = false, onMove, selectedId = null, maxWidth = 900, markerPct, className = "" }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // Λόγος πλευρών: πραγματικές διαστάσεις της εικόνας αν φορτώθηκε, αλλιώς τα μεταδεδομένα, αλλιώς 4:3.
  const w = natural?.w || areaImage?.width || 4;
  const h = natural?.h || areaImage?.height || 3;
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

  return (
    <div
      ref={boxRef}
      className={`@container relative w-full mx-auto overflow-hidden rounded-xl border border-line bg-surface-3 select-none ${className}`}
      style={{
        maxWidth,
        aspectRatio: `${w} / ${h}`,
        ...(areaImage
          ? {}
          : {
              backgroundImage:
                "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
              backgroundSize: "10% 10%",
            }),
      }}
    >
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
