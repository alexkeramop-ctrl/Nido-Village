import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { TableShape } from "@/db/schema";
import { getDb, schema } from "@/db";
import { emit } from "@/server/events";
import { sanitizePlan, type FloorPlan } from "@/lib/floor-plan";
import { MAX_ROOM_COLS, MAX_ROOM_TABLES, ROOM_PRESET, defaultPrefix, freeSpot, gridPositions, nextTableName } from "@/lib/floor-rooms";
import { lineTotalCents } from "./billing";

export async function listAreas(includeInactive = false) {
  const db = await getDb();
  const rows = await db.query.areas.findMany({
    orderBy: [asc(schema.areas.sort), asc(schema.areas.id)],
    with: { tables: { orderBy: [asc(schema.tables.sort), asc(schema.tables.name)] } },
  });
  return includeInactive ? rows : rows.filter((a) => a.active).map((a) => ({ ...a, tables: a.tables.filter((t) => t.active) }));
}

export async function upsertArea(input: { id?: number; name: string; sort?: number; active?: boolean; barStationId?: number | null }) {
  const db = await getDb();
  const values: Partial<typeof schema.areas.$inferInsert> & { name: string } = { name: input.name.trim(), sort: input.sort ?? 0, active: input.active ?? true };
  if (input.barStationId !== undefined) values.barStationId = input.barStationId;
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

export type FloorArea = { id: number; name: string; mapAssetId: number | null; plan: FloorPlan | null; tables: FloorTable[] };

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
  const tableName = new Map(areas.flatMap((a) => a.tables.map((t) => [t.id, t.name] as const)));
  for (const s of open) {
    // Οι παραγγελίες QR από τραπέζι είναι ξεχωριστοί λογαριασμοί πελατών· δεν «πιάνουν» το τραπέζι στην κάτοψη.
    if (s.tableId && s.source !== "qr") byTable.set(s.tableId, summarize(s));
    else
      takeaway.push({
        ...summarize(s),
        label: [s.label ?? `#${s.id}`, s.tableId ? tableName.get(s.tableId) : null].filter(Boolean).join(" · "),
        orderType: s.orderType === "delivery" ? "delivery" : "takeaway",
      });
  }
  return {
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      mapAssetId: a.mapAssetId,
      plan: a.plan ?? null,
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

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

async function writePositions(tx: Tx, areaId: number, positions: TablePosition[]) {
  for (const p of positions) {
    const set: Partial<typeof schema.tables.$inferInsert> = {
      posX: p.posX === null ? null : clamp(p.posX),
      posY: p.posY === null ? null : clamp(p.posY),
    };
    if (p.shape) set.shape = p.shape;
    await tx.update(schema.tables).set(set).where(and(eq(schema.tables.id, p.id), eq(schema.tables.areaId, areaId)));
  }
}

/** Αποθηκεύει θέσεις (0–1000 χιλιοστά) και σχήμα τραπεζιών ενός χώρου. */
export async function saveTablePositions(areaId: number, positions: TablePosition[]) {
  const db = await getDb();
  await db.transaction((tx) => writePositions(tx, areaId, positions));
  emit({ type: "floor.changed" });
}

/** Αποθηκεύει την κάτοψη (δωμάτια) ενός χώρου, αφού την καθαρίσει. Χωρίς δωμάτια γράφεται null. */
export async function saveAreaPlan(areaId: number, plan: unknown) {
  return saveFloorLayout(areaId, [], plan);
}

/** Αποθηκεύει μαζί (σε μία συναλλαγή) τις θέσεις των τραπεζιών και την κάτοψη του χώρου. */
export async function saveFloorLayout(areaId: number, positions: TablePosition[], plan: unknown): Promise<FloorPlan> {
  const clean = sanitizePlan(plan);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.areas)
      .set({ plan: clean.rooms.length ? clean : null })
      .where(eq(schema.areas.id, areaId))
      .returning({ id: schema.areas.id });
    if (!updated.length) throw new Error("Ο χώρος δεν βρέθηκε");
    await writePositions(tx, areaId, positions);
  });
  emit({ type: "floor.changed" });
  return clean;
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

/** Ο ανοιχτός λογαριασμός του τραπεζιού από το προσωπικό (οι παραγγελίες QR πελατών μένουν χωριστές). */
export async function findOpenSessionForTable(tableId: number) {
  const db = await getDb();
  return db.query.tableSessions.findFirst({
    where: and(
      eq(schema.tableSessions.tableId, tableId),
      inArray(schema.tableSessions.status, ["open", "billed"]),
      ne(schema.tableSessions.source, "qr"),
    ),
  });
}

/* ------------------------- Δωμάτια με τραπέζια σε πλέγμα ------------------------- */

export type NewRoomInput = { name: string; count: number; cols: number; prefix?: string; seats?: number };

/**
 * Νέο δωμάτιο (χώρος) με `count` τραπέζια τοποθετημένα σε πλέγμα `cols` στηλών.
 * Τα ονόματα των τραπεζιών είναι πρόθεμα + αριθμός και πρέπει να είναι μοναδικά σε όλο το κατάστημα.
 */
export async function createRoomWithTables(input: NewRoomInput) {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error("Απαιτείται όνομα δωματίου");
  const count = Math.round(input.count);
  const cols = Math.round(input.cols);
  if (!Number.isFinite(count) || count < 0 || count > MAX_ROOM_TABLES) throw new Error(`Τα τραπέζια πρέπει να είναι από 0 έως ${MAX_ROOM_TABLES}`);
  if (!Number.isFinite(cols) || cols < 1 || cols > MAX_ROOM_COLS) throw new Error(`Τα τραπέζια ανά σειρά πρέπει να είναι από 1 έως ${MAX_ROOM_COLS}`);
  const seats = Math.max(1, Math.min(30, Math.round(input.seats ?? 4)));
  const prefix = (input.prefix?.trim() || defaultPrefix(name)).slice(0, 4);
  const db = await getDb();
  return db
    .transaction(async (tx) => {
      const areas = await tx.select().from(schema.areas);
      if (areas.some((a) => a.active && a.name.toLocaleLowerCase("el") === name.toLocaleLowerCase("el"))) throw new Error(`Υπάρχει ήδη δωμάτιο «${name}»`);
      const names = Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
      if (names.length) {
        const clash = await tx.select({ name: schema.tables.name }).from(schema.tables).where(and(inArray(schema.tables.name, names), eq(schema.tables.active, true)));
        if (clash.length) throw new Error(`Υπάρχουν ήδη τραπέζια με πρόθεμα «${prefix}» (π.χ. ${clash[0].name}). Διάλεξε άλλο πρόθεμα.`);
      }
      const bar = (await tx.select().from(schema.printStations)).find((s) => s.kind === "bar" && s.enabled);
      const [area] = await tx
        .insert(schema.areas)
        .values({ name, sort: areas.reduce((m, a) => Math.max(m, a.sort), 0) + 1, barStationId: bar?.id ?? null })
        .returning();
      const pos = gridPositions(count, cols);
      if (count) await tx.insert(schema.tables).values(names.map((n, i) => ({ areaId: area.id, name: n, seats, sort: i + 1, posX: pos[i].posX, posY: pos[i].posY })));
      return { areaId: area.id, tables: count };
    })
    .then((r) => {
      emit({ type: "floor.changed" });
      return r;
    });
}

/** Έτοιμο ξεκίνημα: Παιδική, Σαλόνι, Μπαλκόνι με 20 τραπέζια (4 σειρές × 5) το καθένα. Όσα υπάρχουν ήδη παραλείπονται. */
export async function createRoomPreset(): Promise<{ created: string[]; skipped: string[] }> {
  const existing = new Set((await listAreas()).map((a) => a.name.toLocaleLowerCase("el")));
  const created: string[] = [];
  const skipped: string[] = [];
  for (const r of ROOM_PRESET) {
    if (existing.has(r.name.toLocaleLowerCase("el"))) {
      skipped.push(r.name);
      continue;
    }
    await createRoomWithTables({ name: r.name, prefix: r.prefix, count: 20, cols: 5 });
    created.push(r.name);
  }
  return { created, skipped };
}

/** Προσθέτει ένα τραπέζι στο δωμάτιο: επόμενο όνομα της σειράς, σε ελεύθερο σημείο της κάτοψης. */
export async function addTableToArea(areaId: number, seats = 4) {
  const db = await getDb();
  const area = await db.query.areas.findFirst({ where: eq(schema.areas.id, areaId), with: { tables: true } });
  if (!area || !area.active) throw new Error("Το δωμάτιο δεν βρέθηκε");
  const active = area.tables.filter((t) => t.active);
  if (active.length >= 200) throw new Error("Έως 200 τραπέζια ανά δωμάτιο");
  const everywhere = await db.select({ name: schema.tables.name }).from(schema.tables).where(eq(schema.tables.active, true));
  const name = nextTableName(active.map((t) => t.name), area.name, new Set(everywhere.map((t) => t.name)));
  const spot = freeSpot(active.filter((t) => t.posX !== null && t.posY !== null).map((t) => ({ posX: t.posX!, posY: t.posY! })));
  const [row] = await db
    .insert(schema.tables)
    .values({ areaId, name, seats: Math.max(1, Math.min(30, Math.round(seats))), sort: active.reduce((m, t) => Math.max(m, t.sort), 0) + 1, ...spot })
    .returning();
  emit({ type: "floor.changed" });
  return row;
}

/**
 * Αφαιρεί τραπέζι. Με ανοιχτό λογαριασμό δεν αφαιρείται. Αν έχει ιστορικό πωλήσεων κρύβεται
 * (για να μείνουν σωστές οι αναφορές), αλλιώς διαγράφεται οριστικά.
 */
export async function removeTable(tableId: number): Promise<"deleted" | "archived"> {
  const db = await getDb();
  const table = await db.query.tables.findFirst({ where: eq(schema.tables.id, tableId) });
  if (!table || !table.active) throw new Error("Το τραπέζι δεν βρέθηκε");
  const sessions = await db.select({ status: schema.tableSessions.status }).from(schema.tableSessions).where(eq(schema.tableSessions.tableId, tableId));
  if (sessions.some((s) => s.status === "open" || s.status === "billed")) throw new Error(`Το τραπέζι ${table.name} έχει ανοιχτό λογαριασμό`);
  if (sessions.length) {
    await db.update(schema.tables).set({ active: false, posX: null, posY: null }).where(eq(schema.tables.id, tableId));
    emit({ type: "floor.changed" });
    return "archived";
  }
  await db.delete(schema.tables).where(eq(schema.tables.id, tableId));
  emit({ type: "floor.changed" });
  return "deleted";
}

/**
 * Αφαιρεί ολόκληρο δωμάτιο μαζί με τα τραπέζια του. Δεν γίνεται αν κάποιο τραπέζι έχει ανοιχτό λογαριασμό.
 * Το δωμάτιο και τα τραπέζια κρύβονται (δεν σβήνονται), ώστε παλιές πωλήσεις και κρατήσεις να μείνουν σωστές.
 */
export async function removeArea(areaId: number): Promise<{ name: string; tables: number }> {
  const db = await getDb();
  const area = await db.query.areas.findFirst({ where: eq(schema.areas.id, areaId), with: { tables: true } });
  if (!area || !area.active) throw new Error("Το δωμάτιο δεν βρέθηκε");
  const ids = area.tables.map((t) => t.id);
  if (ids.length) {
    const open = await db
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(and(inArray(schema.tableSessions.tableId, ids), inArray(schema.tableSessions.status, ["open", "billed"])));
    if (open.length) throw new Error(`Το δωμάτιο «${area.name}» έχει τραπέζια με ανοιχτό λογαριασμό`);
  }
  const activeTables = area.tables.filter((t) => t.active).length;
  await db.transaction(async (tx) => {
    if (ids.length) await tx.update(schema.tables).set({ active: false }).where(eq(schema.tables.areaId, areaId));
    await tx.update(schema.areas).set({ active: false }).where(eq(schema.areas.id, areaId));
  });
  emit({ type: "floor.changed" });
  return { name: area.name, tables: activeTables };
}
