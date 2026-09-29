import { getDb, schema } from "@/db";
import { seedDemo } from "@/db/seed";
import { eq } from "drizzle-orm";

export async function seeded() {
  const db = await getDb();
  await seedDemo(db);
  return db;
}

export async function employeeByName(name: string) {
  const db = await getDb();
  const e = await db.query.employees.findFirst({ where: eq(schema.employees.name, name) });
  if (!e) throw new Error("no employee " + name);
  return e;
}

export async function productByName(name: string) {
  const db = await getDb();
  const p = await db.query.products.findFirst({ where: eq(schema.products.name, name) });
  if (!p) throw new Error("no product " + name);
  return p;
}

export async function ingredientByName(name: string) {
  const db = await getDb();
  const i = await db.query.ingredients.findFirst({ where: eq(schema.ingredients.name, name) });
  if (!i) throw new Error("no ingredient " + name);
  return i;
}

export async function modifierByName(name: string) {
  const db = await getDb();
  const m = await db.query.modifiers.findFirst({ where: eq(schema.modifiers.name, name) });
  if (!m) throw new Error("no modifier " + name);
  return m;
}

export async function tableByName(name: string) {
  const db = await getDb();
  const t = await db.query.tables.findFirst({ where: eq(schema.tables.name, name) });
  if (!t) throw new Error("no table " + name);
  return t;
}
