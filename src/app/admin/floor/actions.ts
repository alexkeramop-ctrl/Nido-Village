"use server";
import { revalidatePath } from "next/cache";
import type { TableShape } from "@/db/schema";
import type { FloorPlan } from "@/lib/floor-plan";
import { run } from "@/server/action";
import { requireRole } from "@/server/auth";
import { saveAsset } from "@/server/services/assets";
import { addTableToArea, autoLayoutArea, createRoomPreset, createRoomWithTables, removeArea, removeTable, saveFloorLayout, saveTablePositions, setAreaMap, type NewRoomInput, type TablePosition } from "@/server/services/floor";

const SHAPES: TableShape[] = ["square", "round", "wide"];
const MAX_UPLOAD = 3 * 1024 * 1024;

function revalidate() {
  revalidatePath("/admin/floor");
  revalidatePath("/admin/tables");
  revalidatePath("/admin/qr");
  revalidatePath("/pda");
}

function areaIdOf(v: unknown) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Μη έγκυρος χώρος");
  return n;
}

function permille(v: unknown) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Μη έγκυρη θέση τραπεζιού");
  return Math.max(0, Math.min(1000, Math.round(n)));
}

function cleanPositions(positions: TablePosition[]): TablePosition[] {
  if (!Array.isArray(positions) || positions.length > 500) throw new Error("Μη έγκυρα δεδομένα θέσεων");
  return positions.map((p) => {
    const tableId = Number(p.id);
    if (!Number.isInteger(tableId) || tableId <= 0) throw new Error("Μη έγκυρο τραπέζι");
    const posX = permille(p.posX);
    const posY = permille(p.posY);
    if (p.shape !== undefined && !SHAPES.includes(p.shape)) throw new Error("Μη έγκυρο σχήμα τραπεζιού");
    const pos = posX === null || posY === null ? { posX: null, posY: null } : { posX, posY };
    return p.shape ? { id: tableId, ...pos, shape: p.shape } : { id: tableId, ...pos };
  });
}

/** Αποθηκεύει θέσεις/σχήματα όλων των τραπεζιών ενός χώρου. */
export async function saveTablePositionsAction(areaId: number, positions: TablePosition[]) {
  return run(async () => {
    await requireRole("manager", "admin");
    const id = areaIdOf(areaId);
    const clean = cleanPositions(positions);
    await saveTablePositions(id, clean);
    revalidate();
    return clean.length;
  });
}

/** Αποθηκεύει μαζί τις θέσεις των τραπεζιών και την κάτοψη (δωμάτια) ενός χώρου. */
export async function saveFloorLayoutAction(areaId: number, positions: TablePosition[], plan: FloorPlan) {
  return run(async () => {
    await requireRole("manager", "admin");
    const id = areaIdOf(areaId);
    const saved = await saveFloorLayout(id, cleanPositions(positions), plan);
    revalidate();
    return saved.rooms.length;
  });
}

/** Αυτόματη διάταξη σε πλέγμα: μόνο για όσα δεν έχουν θέση, ή για όλα με force. */
export async function autoLayoutAction(areaId: number, force = false) {
  return run(async () => {
    await requireRole("manager", "admin");
    const n = await autoLayoutArea(areaIdOf(areaId), force === true);
    revalidate();
    return n;
  });
}

/** Ανέβασμα εικόνας χάρτη (FormData: file, width, height, areaId). Έως 3MB. */
export async function uploadAreaMapAction(formData: FormData) {
  return run(async () => {
    await requireRole("manager", "admin");
    const areaId = areaIdOf(formData.get("areaId"));
    const file = formData.get("file") as File | null;
    if (!file || typeof file === "string" || !file.size) throw new Error("Επίλεξε μια εικόνα");
    if (file.size > MAX_UPLOAD) throw new Error("Η εικόνα πρέπει να είναι έως 3MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    const dim = (key: string) => {
      const n = Number(formData.get(key));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };
    const asset = await saveAsset({ kind: "map", mime: file.type, bytes, width: dim("width"), height: dim("height") });
    await setAreaMap(areaId, asset.id);
    revalidate();
    return asset.id;
  });
}

export async function removeAreaMapAction(areaId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    await setAreaMap(areaIdOf(areaId), null);
    revalidate();
  });
}

/** Νέο δωμάτιο με τραπέζια σε πλέγμα (π.χ. 20 τραπέζια, 5 ανά σειρά). */
export async function createRoomAction(input: NewRoomInput) {
  return run(async () => {
    await requireRole("manager", "admin");
    const r = await createRoomWithTables({
      name: String(input?.name ?? ""),
      count: Number(input?.count),
      cols: Number(input?.cols),
      prefix: input?.prefix ? String(input.prefix) : undefined,
      seats: input?.seats === undefined ? undefined : Number(input.seats),
    });
    revalidate();
    return r;
  });
}

/** Έτοιμο ξεκίνημα: Παιδική, Σαλόνι, Μπαλκόνι με 20 τραπέζια το καθένα. */
export async function createRoomPresetAction() {
  return run(async () => {
    await requireRole("manager", "admin");
    const r = await createRoomPreset();
    revalidate();
    return r;
  });
}

/** Προσθήκη ενός τραπεζιού στο δωμάτιο (επόμενο όνομα, ελεύθερο σημείο). */
export async function addTableAction(areaId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    const row = await addTableToArea(areaIdOf(areaId));
    revalidate();
    return { id: row.id, name: row.name };
  });
}

/** Αφαίρεση τραπεζιού από το δωμάτιο. */
export async function removeTableAction(tableId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    const id = Number(tableId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Μη έγκυρο τραπέζι");
    const mode = await removeTable(id);
    revalidate();
    return mode;
  });
}

/** Αφαίρεση ολόκληρου δωματίου (με τα τραπέζια του). */
export async function removeRoomAction(areaId: number) {
  return run(async () => {
    await requireRole("manager", "admin");
    const r = await removeArea(areaIdOf(areaId));
    revalidate();
    return r;
  });
}
