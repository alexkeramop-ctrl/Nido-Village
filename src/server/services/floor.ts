import { and, asc, eq, inArray } from "drizzle-orm";
import type { TableShape } from "@/db/schema";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";
import { lineTotalCents } from "./billing";

export async function listAreas(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.areas.findMany({
    orderBy: [asc(schema.areas.sort), asc(schema.areas.id)],
    with: { tables: { orderBy: [asc(schema.tables.sort), asc(schema.tables.name)] } },
  });
  return includeInactive ? rows : rows.filter((a) => a.active).map((a) => ({ ...a, tables: a.tables.filter((t) => t.active) }));
}

export async function upsertArea(input: { id?: number; name: string; sort?: number; active?: boolean }) {
  const db = await getDb();
  const values = { name: input.name.trim(), sort: input.sort ?? 0, active: input.active ?? true };
  if (!values.name) throw new Error("Απαιτείται όνομα χώρου");
  const [row] = input.id
    ? await db.update(schema.areas).set(values).where(eq(schema.areas.id, input.id)).returning()
    : await db.insert(schema.areas).values(values).returning();
  emit({ type: "floor.changed" });
  return row;
}

export async function upsertTable(input: { id?: number; areaId: number; name: string; seats?: number; sort?: number; active?: boolean }) {
  const db = await getDb();
  const values = {
    areaId: input.areaId,
    name: input.name.trim(),
    seats: input.seats ?? 4,
    sort: input.sort ?? 0,
    active: input.active ?? true,
  };
  if (!values.name) throw new Error("Απαιτείται όνομα τραπεζιού");
  const [row] = input.id
    ? await db.update(schema.tables).set(values).where(eq(schema.tables.id, input.id)).returning()
    : await db.insert(schema.tables).values(values).returning();
  emit({ type: "floor.changed" });
  return row;
}

/** Δημιουργεί πολλά τραπέζια μαζί, π.χ. "Α" 1..10. */
export async function createTablesBatch(areaId: number, prefix: string, from: number, to: number, seats = 4) {
  const db = await getDb();
  const values = [];
  for (let n = from; n <= to; n++) values.push({ areaId, name: `${prefix}${n}`, seats, sort: n });
  if (!values.length) return [];
  const rows = await db.insert(schema.tables).values(values).returning();
  emit({ type: "floor.changed" });
  return rows;
}

export type FloorTable = {
  id: number;
  name: string;
  seats: number;
  posX: number | null;
  posY: number | null;
  shape: TableShape;
  session: null | {
    id: number;
    openedAt: Date;
    covers: number;
    status: "open" | "billed";
    waiter: string;
    itemCount: number;
    totalCents: number;
    minutesOpen: number;
  };
};

export type FloorArea = { id: number; name: string; mapAssetId: number | null; tables: FloorTable[] };

export type TakeawaySession = {
  id: number;
  label: string;
  orderType: "takeaway" | "delivery";
  openedAt: Date;
  status: "open" | "billed";
  waiter: string;
  itemCount: number;
  totalCents: number;
  minutesOpen: number;
};

/** Η κάτοψη με τα ανοιχτά τραπέζια και σύνοψη κάθε ανοιχτής συνεδρίας. */
export async function getFloor(): Promise<{ areas: FloorArea[]; takeaway: TakeawaySession[] }> {
  const db = await getDb();
  const areas = await listAreas();
  const open = await db.query.tableSessions.findMany({
    where: inArray(schema.tableSessions.status, ["open", "billed"]),
    with: { openedByEmployee: true, items: { with: { modifiers: true } } },
  });
  const now = Date.now();
  const summarize = (s: (typeof open)[number]) => {
    const live = s.items.filter((i) => i.status !== "voided");
    return {
      id: s.id,
      openedAt: s.openedAt,
      covers: s.covers,
      status: s.status as "open" | "billed",
      waiter: s.openedByEmployee.name,
      itemCount: live.reduce((n, i) => n + i.qty, 0),
      totalCents: live.reduce((n, i) => n + lineTotalCents(i), 0) - s.discountCents,
      minutesOpen: Math.floor((now - s.openedAt.getTime()) / 60000),
    };
  };
  const byTable = new Map<number, ReturnType<typeof summarize>>();
  const takeaway: TakeawaySession[] = [];
  for (const s of open) {
    if (s.tableId) byTable.set(s.tableId, summarize(s));
    else
      takeaway.push({
        ...summarize(s),
        label: s.label ?? `#${s.id}`,
        orderType: s.orderType === "delivery" ? "delivery" : "takeaway",
      });
  }
  return {
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      mapAssetId: a.mapAssetId,
      tables: a.tables.map((t) => ({
        id: t.id,
        name: t.name,
        seats: t.seats,
        posX: t.posX,
        posY: t.posY,
        shape: t.shape,
        session: byTable.get(t.id) ?? null,
      })),
    })),
    takeaway: takeaway.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime()),
  };
}

/* ------------------------------ Χάρτης χώρου ------------------------------ */

export type TablePosition = { id: number; posX: number | null; posY: number | null; shape?: TableShape };

const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/** Αποθηκεύει θέσεις (0–1000 χιλιοστά) και σχήμα τραπεζιών ενός χώρου. */
export async function saveTablePositions(areaId: number, positions: TablePosition[]) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const p of positions) {
      const set: Partial<typeof schema.tables.$inferInsert> = {
        posX: p.posX === null ? null : clamp(p.posX),
        posY: p.posY === null ? null : clamp(p.posY),
      };
      if (p.shape) set.shape = p.shape;
      await tx.update(schema.tables).set(set).where(and(eq(schema.tables.id, p.id), eq(schema.tables.areaId, areaId)));
    }
  });
  emit({ type: "floor.changed" });
}

/** Ορίζει (ή αφαιρεί) την εικόνα φόντου του χάρτη ενός χώρου. */
export async function setAreaMap(areaId: number, assetId: number | null) {
  const db = await getDb();
  await db.update(schema.areas).set({ mapAssetId: assetId }).where(eq(schema.areas.id, areaId));
  emit({ type: "floor.changed" });
}

/** Αυτόματη διάταξη σε πλέγμα για όσα τραπέζια δεν έχουν θέση (ή για όλα, με force). */
export async function autoLayoutArea(areaId: number, force = false) {
  const db = await getDb();
  const rows = await db.query.tables.findMany({
    where: and(eq(schema.tables.areaId, areaId), eq(schema.tables.active, true)),
    orderBy: [asc(schema.tables.sort), asc(schema.tables.name)],
  });
  const targets = force ? rows : rows.filter((t) => t.posX === null || t.posY === null);
  if (!targets.length) return 0;
  const cols = Math.max(2, Math.ceil(Math.sqrt(targets.length * 1.4)));
  const rowsN = Math.ceil(targets.length / cols);
  const positions: TablePosition[] = targets.map((t, i) => ({
    id: t.id,
    posX: Math.round(((i % cols) + 0.5) * (1000 / cols)),
    posY: Math.round((Math.floor(i / cols) + 0.5) * (1000 / Math.max(rowsN, 1))),
  }));
  await saveTablePositions(areaId, positions);
  return positions.length;
}

export async function findOpenSessionForTable(tableId: number) {
  const db = await getDb();
  return db.query.tableSessions.findFirst({
    where: and(eq(schema.tableSessions.tableId, tableId), inArray(schema.tableSessions.status, ["open", "billed"])),
  });
}
