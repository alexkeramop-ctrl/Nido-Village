import { describe, expect, it } from "vitest";
import { MAX_ROOMS, MAX_ROOM_NAME, MIN_ROOM_SIZE, ROOM_COLORS, clampRoomRect, nextRoom, presetThreeRooms, samePlan, sanitizePlan } from "@/lib/floor-plan";

describe("sanitizePlan", () => {
  it("κενή/απούσα κάτοψη δίνει άδεια λίστα", () => {
    expect(sanitizePlan(null)).toEqual({ rooms: [] });
    expect(sanitizePlan(undefined)).toEqual({ rooms: [] });
    expect(sanitizePlan({})).toEqual({ rooms: [] });
    expect(sanitizePlan({ rooms: [] })).toEqual({ rooms: [] });
  });

  it("απορρίπτει άκυρη μορφή και υπερβολικό πλήθος", () => {
    expect(() => sanitizePlan("rooms")).toThrow();
    expect(() => sanitizePlan({ rooms: "x" })).toThrow();
    const many = Array.from({ length: MAX_ROOMS + 1 }, (_, i) => ({ id: `r${i}`, name: "Α", x: 0, y: 0, w: 100, h: 100 }));
    expect(() => sanitizePlan({ rooms: many })).toThrow();
    expect(sanitizePlan({ rooms: many.slice(0, MAX_ROOMS) }).rooms).toHaveLength(MAX_ROOMS);
  });

  it("περιορίζει συντεταγμένες στον καμβά με ελάχιστο μέγεθος και στρογγυλοποιεί", () => {
    const { rooms } = sanitizePlan({
      rooms: [
        { id: "a", name: "Σάλα", x: -200, y: 990.6, w: 10, h: 2000 },
        { id: "b", name: "Β", x: "950", y: 10.4, w: 300.5, h: 100 },
      ],
    });
    expect(rooms[0]).toMatchObject({ x: 0, y: 0, w: MIN_ROOM_SIZE, h: 1000 });
    expect(rooms[1]).toMatchObject({ x: 699, y: 10, w: 301, h: 100 });
    for (const r of rooms) {
      expect(r.x + r.w).toBeLessThanOrEqual(1000);
      expect(r.y + r.h).toBeLessThanOrEqual(1000);
    }
  });

  it("παραλείπει δωμάτια χωρίς αριθμητικές διαστάσεις ή άκυρα στοιχεία", () => {
    const { rooms } = sanitizePlan({
      rooms: [null, 5, "x", { id: "a", name: "ΟΚ", x: 1, y: 1, w: 100, h: 100 }, { id: "b", x: NaN, y: 0, w: 100, h: 100 }, { id: "c", x: 0, y: 0, w: Infinity, h: 100 }, { id: "d", x: {}, y: 0, w: 1, h: 1 }],
    });
    expect(rooms.map((r) => r.id)).toEqual(["a"]);
  });

  it("καθαρίζει όνομα, χρώμα και id· κρατά μόνο τα γνωστά πεδία", () => {
    const { rooms } = sanitizePlan({
      rooms: [
        { id: "<script>", name: `  Πολύ\n\tμεγάλο ${"χ".repeat(100)}`, x: 0, y: 0, w: 100, h: 100, color: "url(evil)", extra: "drop me" },
        { id: "same", name: "", x: 0, y: 0, w: 100, h: 100, color: "lavender" },
        { id: "same", name: 42, x: 0, y: 0, w: 100, h: 100 },
        { name: "Χωρίς id", x: 0, y: 0, w: 100, h: 100 },
      ],
    });
    expect(rooms[0].id).toBe("script");
    expect(rooms[0].name.length).toBe(MAX_ROOM_NAME);
    expect(rooms[0].name.startsWith("Πολύ μεγάλο ")).toBe(true);
    expect(rooms[0].color).toBe(ROOM_COLORS[0].key);
    expect(Object.keys(rooms[0]).sort()).toEqual(["color", "h", "id", "name", "w", "x", "y"]);
    expect(rooms[1]).toMatchObject({ id: "same", name: "Ζώνη", color: "lavender" });
    expect(rooms[2].name).toBe("Ζώνη");
    expect(new Set(rooms.map((r) => r.id)).size).toBe(4);
    expect(rooms.every((r) => /^[A-Za-z0-9_-]{1,40}$/.test(r.id))).toBe(true);
  });

  it("είναι ιδεοδύναμη", () => {
    const once = sanitizePlan({ rooms: presetThreeRooms() });
    expect(sanitizePlan(once)).toEqual(once);
  });
});

describe("βοηθητικά κάτοψης", () => {
  it("η έτοιμη αρχή έχει 3 έγκυρα δωμάτια που δεν επικαλύπτονται", () => {
    const rooms = presetThreeRooms();
    expect(rooms.map((r) => r.name)).toEqual(["Σάλα", "Βεράντα", "Κήπος"]);
    expect(sanitizePlan({ rooms }).rooms).toEqual(rooms);
    for (const a of rooms)
      for (const b of rooms) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });

  it("clampRoomRect και nextRoom μένουν μέσα στον καμβά", () => {
    expect(clampRoomRect({ x: 990, y: -5, w: 20, h: 3000 })).toEqual({ x: 900, y: 0, w: MIN_ROOM_SIZE, h: 1000 });
    let rooms = presetThreeRooms();
    for (let i = 0; i < 10; i++) {
      const r = nextRoom(rooms);
      expect(r.x + r.w).toBeLessThanOrEqual(1000);
      expect(r.y + r.h).toBeLessThanOrEqual(1000);
      expect(rooms.some((o) => o.id === r.id)).toBe(false);
      rooms = [...rooms, r];
    }
  });

  it("samePlan συγκρίνει δωμάτια", () => {
    const a = presetThreeRooms();
    expect(samePlan(a, a.map((r) => ({ ...r })))).toBe(true);
    expect(samePlan(a, a.slice(0, 2))).toBe(false);
    expect(samePlan(a, a.map((r, i) => (i ? r : { ...r, w: r.w + 1 })))).toBe(false);
  });

  it("έτοιμα στοιχεία χώρου: κρατά μόνο γνωστό είδος, δίνει προεπιλεγμένο μέγεθος και αρίθμηση", async () => {
    const { nextFixture, samePlan, sanitizePlan: clean } = await import("@/lib/floor-plan");
    const bar = nextFixture([], "bar");
    expect(bar).toMatchObject({ name: "Μπαρ", kind: "bar", w: 420, h: 120 });
    expect(nextFixture([bar], "bar").name).toBe("Μπαρ 2");
    const fire = nextFixture([bar], "fireplace");
    expect(fire).toMatchObject({ name: "Τζάκι", kind: "fireplace" });
    // Το νέο στοιχείο δεν πέφτει πάνω στο προηγούμενο.
    expect(fire.x >= bar.x + bar.w || fire.x + fire.w <= bar.x || fire.y >= bar.y + bar.h || fire.y + fire.h <= bar.y).toBe(true);
    const out = clean({ rooms: [bar, { ...bar, id: "x1", kind: "<script>" }, { ...bar, id: "x2", kind: "kitchen" }] }).rooms;
    expect(out.map((r) => r.kind)).toEqual(["bar", undefined, "kitchen"]);
    expect(samePlan([bar], [{ ...bar, kind: "kitchen" }])).toBe(false);
    expect(samePlan([bar], [{ ...bar }])).toBe(true);
  });
});
