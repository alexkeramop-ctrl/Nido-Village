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
