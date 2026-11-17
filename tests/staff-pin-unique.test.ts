import { describe, expect, it } from "vitest";
import { seeded } from "./helpers";
import { upsertEmployee } from "@/server/services/staff";

describe("μοναδικό PIN υπαλλήλων", () => {
  it("δεν επιτρέπει δεύτερο υπάλληλο με το ίδιο PIN (ούτε του διαχειριστή)", async () => {
    await seeded();
    await expect(upsertEmployee({ name: "Νέος σερβιτόρος", role: "waiter", pin: "1234" })).rejects.toThrow(/PIN/);
  });
  it("επιτρέπει νέο υπάλληλο με διαφορετικό PIN και αλλαγή στο δικό του PIN", async () => {
    const e = await upsertEmployee({ name: "Γιάννης", role: "waiter", pin: "918273" });
    expect(e.id).toBeGreaterThan(0);
    const again = await upsertEmployee({ id: e.id, name: "Γιάννης", role: "waiter", pin: "918273" });
    expect(again.id).toBe(e.id);
  });
});
