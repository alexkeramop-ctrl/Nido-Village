import { describe, expect, it } from "vitest";
import { demoPins } from "@/db/seed";

describe("demo PINs", () => {
  it("χωρίς NIDO_ADMIN_PIN κρατά τα γνωστά demo PIN", () => {
    const p = demoPins(undefined);
    expect(p.custom).toBe(false);
    expect(p.admin).toBe("1234");
    expect(p.next("4444")).toBe("4444");
  });
  it("με NIDO_ADMIN_PIN: δικό PIN για τον διαχειριστή, μοναδικά τυχαία για τους άλλους", () => {
    const p = demoPins("907153");
    expect(p.custom).toBe(true);
    expect(p.admin).toBe("907153");
    const others = ["4444", "2222", "1111", "3333", "5555"].map((d) => p.next(d));
    for (const pin of others) {
      expect(pin).toMatch(/^\d{6}$/);
      expect(["1234", "4444", "2222", "1111", "3333", "5555", "907153"]).not.toContain(pin);
    }
    expect(new Set(others).size).toBe(others.length);
  });
  it("απορρίπτει μη έγκυρο PIN", () => {
    expect(() => demoPins("12a4")).toThrow();
  });
});

describe("καθαρό ξεκίνημα online", () => {
  it("με NIDO_ADMIN_PIN φορτώνεται μόνο ο διαχειριστής, χωρίς demo μενού/αποθήκη/τραπέζια", async () => {
    const { seedClean, seedMode } = await import("@/db/seed");
    const { getDb, schema } = await import("@/db");
    const prev = process.env.NIDO_ADMIN_PIN;
    process.env.NIDO_ADMIN_PIN = "907153";
    try {
      expect(seedMode()).toBe("clean");
      const db = await getDb();
      await seedClean(db);
      expect((await db.select().from(schema.employees)).map((e) => e.role)).toEqual(["admin"]);
      expect(await db.select().from(schema.products)).toHaveLength(0);
      expect(await db.select().from(schema.ingredients)).toHaveLength(0);
      expect(await db.select().from(schema.tables)).toHaveLength(0);
      expect(await db.select().from(schema.areas)).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.NIDO_ADMIN_PIN;
      else process.env.NIDO_ADMIN_PIN = prev;
    }
  });
});
