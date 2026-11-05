import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { embeddedMigrations } from "@/db/migrations.generated";

// Στο Cloudflare τα migrations τρέχουν από το ενσωματωμένο αρχείο: πρέπει να είναι ίδιο με τον φάκελο drizzle/.
describe("embedded migrations", () => {
  it("ταιριάζουν με drizzle/ (τρέξτε: node scripts/embed-migrations.mjs)", () => {
    expect(embeddedMigrations).toEqual(readMigrationFiles({ migrationsFolder: "drizzle" }));
  });
});
