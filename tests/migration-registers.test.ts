import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const statements = (file: string) =>
  readFileSync(`drizzle/${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

// Η 0006 εφαρμόζεται σε βάση παραγωγής που ΗΔΗ έχει γραμμές: πρέπει να είναι μόνο προσθετική και να μην τις αγγίζει.
describe("migration 0006_registers_buzzer", () => {
  it("είναι μόνο προσθετική (χωρίς DROP / NOT NULL σε υπάρχοντες πίνακες / αλλαγές δεδομένων)", () => {
    const sql = readFileSync("drizzle/0006_registers_buzzer.sql", "utf8");
    // (το «ON DELETE no action ON UPDATE no action» των ξένων κλειδιών δεν είναι εντολή)
    expect(sql.replace(/ON DELETE no action ON UPDATE no action/g, "")).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|ALTER COLUMN|RENAME/i);
    for (const stmt of statements("0006_registers_buzzer.sql")) {
      expect(stmt).toMatch(/^(CREATE TABLE|ALTER TABLE "\w+" ADD (COLUMN|CONSTRAINT)|CREATE (UNIQUE )?INDEX)/);
      if (/ADD COLUMN/.test(stmt)) expect(stmt).not.toMatch(/NOT NULL/);
    }
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
    const whens = journal.entries.map((e) => e.when);
    // Το drizzle εφαρμόζει ένα migration μόνο αν είναι νεότερο από το τελευταίο που έτρεξε.
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
    expect(journal.entries.at(-1)?.tag).toBe("0006_registers_buzzer");
  });

  it("εφαρμόζεται πάνω σε βάση με υπάρχουσες βάρδιες, λογαριασμούς και πληρωμές χωρίς να τις αλλάξει", async () => {
    const pg = new PGlite();
    for (const f of ["0000_init.sql", "0001_cloud.sql", "0002_floor_qr.sql", "0003_staff_bars_packs_events.sql", "0004_finance_parties.sql", "0005_floor_plan.sql"]) {
      for (const stmt of statements(f)) await pg.exec(stmt);
    }
    await pg.exec(`
      insert into employees (name, role, pin_hash) values ('Παλιός ταμίας', 'cashier', 'x');
      insert into cash_sessions (opened_by, opening_float_cents, closed_at, closed_by, counted_cash_cents, expected_cash_cents) values (1, 1000, now(), 1, 2500, 2500);
      insert into cash_sessions (opened_by, opening_float_cents) values (1, 2000);
      insert into table_sessions (order_type, label, status, opened_by) values ('takeaway', 'α', 'closed', 1), ('takeaway', 'β', 'open', 1), ('takeaway', 'γ', 'closed', 1);
      insert into payments (session_id, cash_session_id, method, amount_cents, employee_id) values (1, 1, 'cash', 1500, 1), (3, 2, 'card', 700, 1), (3, null, 'cash', 300, 1);
    `);
    for (const stmt of statements("0006_registers_buzzer.sql")) await pg.exec(stmt);

    const shifts = await pg.query<{ id: number; register_id: number | null; opening_float_cents: number; closed_at: Date | null }>("select * from cash_sessions order by id");
    expect(shifts.rows.map((r) => [r.register_id, r.opening_float_cents, r.closed_at === null])).toEqual([
      [null, 1000, false],
      [null, 2000, true],
    ]);
    const sessions = await pg.query<{ buzzer_no: number | null; client_ref: string | null; status: string }>("select buzzer_no, client_ref, status from table_sessions order by id");
    expect(sessions.rows).toEqual([
      { buzzer_no: null, client_ref: null, status: "closed" },
      { buzzer_no: null, client_ref: null, status: "open" },
      { buzzer_no: null, client_ref: null, status: "closed" },
    ]);
    const pays = await pg.query<{ n: number; total: number }>("select count(*)::int as n, sum(amount_cents)::int as total from payments");
    expect(pays.rows[0]).toEqual({ n: 3, total: 2500 });
    expect((await pg.query<{ n: number }>("select count(*)::int as n from registers")).rows[0].n).toBe(0);

    // Οι νέοι κανόνες ισχύουν: παλιές ανοιχτές βάρδιες χωρίς ταμείο επιτρέπονται, δεύτερη ανοιχτή στο ίδιο ταμείο όχι.
    await pg.exec(`insert into registers (name) values ('Ταμείο 1'); insert into cash_sessions (opened_by) values (1); update cash_sessions set register_id = 1 where id = 2;`);
    await expect(pg.exec("update cash_sessions set register_id = 1 where id = 3")).rejects.toThrow(/cash_sessions_open_register_uq/);
    await pg.exec("update table_sessions set client_ref = 'k1' where id = 1");
    await expect(pg.exec("update table_sessions set client_ref = 'k1' where id = 2")).rejects.toThrow(/unique/i);
    await pg.close();
  });
});
