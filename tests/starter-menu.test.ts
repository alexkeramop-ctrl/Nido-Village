import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { loadStarterMenu, STARTER_MENU } from "@/db/starter-menu";
import { seeded } from "./helpers";

describe("βασικό μενού", () => {
  it("προσθέτει τα είδη μία φορά και δεν διπλοπερνά", async () => {
    const db = await seeded();
    const total = STARTER_MENU.reduce((n, g) => n + g.items.length, 0);
    const first = await loadStarterMenu();
    expect(first.products).toBeGreaterThan(0);
    expect(first.products).toBeLessThanOrEqual(total);
    const second = await loadStarterMenu();
    expect(second).toEqual({ categories: 0, products: 0 });
    const cats = await db.select().from(schema.categories);
    expect(cats.map((c) => c.name)).toContain("Cocktail");
    const mojito = (await db.select().from(schema.products)).find((p) => p.name === "Mojito");
    expect(mojito?.priceCents).toBe(900);
  });
});

describe("μενού κουζίνας", () => {
  it("προσθέτει τα πιάτα στην κουζίνα με επιλογή πατάτας, μία φορά", async () => {
    const { loadKitchenMenu, KITCHEN_MENU } = await import("@/db/starter-menu");
    const { eq, inArray } = await import("drizzle-orm");
    const db = await seeded();
    const total = KITCHEN_MENU.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(34);
    const first = await loadKitchenMenu();
    expect(first.products).toBe(total);
    expect(await loadKitchenMenu()).toEqual({ categories: 0, products: 0 });

    const kitchen = (await db.select().from(schema.printStations)).find((s) => s.kind === "kitchen")!;
    const cats = await db.select().from(schema.categories).where(inArray(schema.categories.name, KITCHEN_MENU.map((g) => g.category)));
    expect(cats).toHaveLength(KITCHEN_MENU.length);
    for (const c of cats) expect(c.printStationId).toBe(kitchen.id);

    const burger = (await db.select().from(schema.products)).find((p) => p.name === "Classic Burger 190γρ")!;
    expect(burger.priceCents).toBe(950);
    const links = await db.select().from(schema.productModifierGroups).where(eq(schema.productModifierGroups.productId, burger.id));
    expect(links).toHaveLength(1);
    const fries = await db.select().from(schema.modifiers).where(eq(schema.modifiers.groupId, links[0].groupId));
    expect(fries.map((m) => [m.name, m.priceDeltaCents])).toEqual([["Με πατάτες", 200]]);
    // Μία μόνο ομάδα «Πατάτες», κοινή για όλα τα burgers.
    expect((await db.select().from(schema.modifierGroups)).filter((g) => g.name === "Πατάτες")).toHaveLength(1);
    const salad = (await db.select().from(schema.products)).find((p) => p.name === "Σαλάτα Caesar's")!;
    expect(await db.select().from(schema.productModifierGroups).where(eq(schema.productModifierGroups.productId, salad.id))).toHaveLength(0);
  });
});
