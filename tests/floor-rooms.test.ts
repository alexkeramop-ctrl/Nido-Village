import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { freeSpot, gridPositions, nextTableName } from "@/lib/floor-rooms";
import { addTableToArea, createRoomPreset, createRoomWithTables, listAreas, removeArea, removeTable } from "@/server/services/floor";
import { openSession } from "@/server/services/ordering";
import { employeeByName, seeded } from "./helpers";

describe("δωμάτια με τραπέζια σε πλέγμα", () => {
  it("20 τραπέζια, 5 ανά σειρά = 4 σειρές, χωρίς επικαλύψεις", () => {
    const pos = gridPositions(20, 5);
    expect(pos).toHaveLength(20);
    expect(new Set(pos.map((p) => p.posX)).size).toBe(5);
    expect(new Set(pos.map((p) => p.posY)).size).toBe(4);
    expect(pos[0]).toEqual({ posX: 100, posY: 125 });
    expect(pos[19]).toEqual({ posX: 900, posY: 875 });
    expect(new Set(pos.map((p) => `${p.posX},${p.posY}`)).size).toBe(20);
  });

  it("επόμενο όνομα τραπεζιού και ελεύθερο σημείο", () => {
    expect(nextTableName(["Π1", "Π2", "Π20"], "Παιδική")).toBe("Π21");
    expect(nextTableName([], "Σαλόνι")).toBe("Σ1");
    expect(nextTableName(["Μ1"], "Μπαλκόνι", new Set(["Μ2"]))).toBe("Μ3");
    const full = gridPositions(20, 5);
    const spot = freeSpot(full);
    expect(full.some((p) => p.posX === spot.posX && p.posY === spot.posY)).toBe(false);
    const withHole = full.filter((_, i) => i !== 7);
    expect(freeSpot(withHole)).toEqual(full[7]);
  });

  it("το έτοιμο ξεκίνημα φτιάχνει Παιδική, Σαλόνι, Μπαλκόνι με 20 τραπέζια και δεν διπλοπερνά", async () => {
    await seeded();
    const db = await getDb();
    // Το demo έχει ήδη «Παιδική»: την κρύβουμε για να δοκιμάσουμε καθαρά το preset.
    await db.update(schema.areas).set({ active: false });
    await db.update(schema.tables).set({ active: false });
    const first = await createRoomPreset();
    expect(first.created).toEqual(["Παιδική", "Σαλόνι", "Μπαλκόνι"]);
    const areas = await listAreas();
    expect(areas.map((a) => a.name)).toEqual(["Παιδική", "Σαλόνι", "Μπαλκόνι"]);
    for (const a of areas) {
      expect(a.tables).toHaveLength(20);
      expect(a.tables.every((t) => t.posX !== null && t.posY !== null)).toBe(true);
      expect(a.barStationId).not.toBeNull();
    }
    expect(areas[1].tables.map((t) => t.name).slice(0, 3)).toEqual(["Σ1", "Σ2", "Σ3"]);
    const second = await createRoomPreset();
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(3);
  });

  it("προσθήκη και αφαίρεση τραπεζιού· με ανοιχτό λογαριασμό δεν αφαιρείται, με ιστορικό κρύβεται", async () => {
    const room = await createRoomWithTables({ name: "Αυλή", count: 3, cols: 3, prefix: "Υ" });
    const added = await addTableToArea(room.areaId);
    expect(added.name).toBe("Υ4");
    expect(added.posX).not.toBeNull();
    expect(await removeTable(added.id)).toBe("deleted");

    const db = await getDb();
    const [t1] = await db.select().from(schema.tables).where(eq(schema.tables.name, "Υ1"));
    const waiter = await employeeByName("Μαρία");
    const session = await openSession({ tableId: t1.id, covers: 2 }, waiter.id);
    await expect(removeTable(t1.id)).rejects.toThrow(/ανοιχτό λογαριασμό/);
    await db.update(schema.tableSessions).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tableSessions.id, session.id));
    expect(await removeTable(t1.id)).toBe("archived");
    const [after] = await db.select().from(schema.tables).where(eq(schema.tables.id, t1.id));
    expect(after.active).toBe(false);
  });

  it("αφαίρεση δωματίου: κρύβει δωμάτιο και τραπέζια, όχι με ανοιχτό λογαριασμό· το όνομα ξαναχρησιμοποιείται", async () => {
    const room = await createRoomWithTables({ name: "Κήπος", count: 4, cols: 2, prefix: "Η" });
    const db = await getDb();
    const [t] = await db.select().from(schema.tables).where(eq(schema.tables.name, "Η1"));
    const waiter = await employeeByName("Μαρία");
    const session = await openSession({ tableId: t.id, covers: 1 }, waiter.id);
    await expect(removeArea(room.areaId)).rejects.toThrow(/ανοιχτό λογαριασμό/);
    await db.update(schema.tableSessions).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tableSessions.id, session.id));
    expect(await removeArea(room.areaId)).toEqual({ name: "Κήπος", tables: 4 });
    expect((await listAreas()).some((a) => a.name === "Κήπος")).toBe(false);
    const again = await createRoomWithTables({ name: "Κήπος", count: 2, cols: 2, prefix: "Η" });
    expect(again.tables).toBe(2);
  });

  it("αρνείται διπλό όνομα δωματίου και πρόθεμα που συγκρούεται", async () => {
    await expect(createRoomWithTables({ name: "αυλή", count: 2, cols: 2, prefix: "Ω" })).rejects.toThrow(/Υπάρχει ήδη δωμάτιο/);
    await expect(createRoomWithTables({ name: "Ταράτσα", count: 2, cols: 2, prefix: "Υ" })).rejects.toThrow(/πρόθεμα/);
    await expect(createRoomWithTables({ name: "Ταράτσα", count: 500, cols: 5 })).rejects.toThrow(/από 0 έως/);
  });
});
