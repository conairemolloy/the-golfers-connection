// Group 10 — coverage guard.
//
// Catches a future table added without RLS: every table in the public
// schema must have rowsecurity enabled and zero grants to anon. Table
// list is discovered at runtime, same as group 1.
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./harness";

const rlsRows = await db.execute<{ table_name: string; rowsecurity: boolean }>(
  sql`select c.relname as table_name, c.relrowsecurity as rowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
);

const anonGrants = await db.execute<{ table_name: string; privilege_type: string }>(
  sql`select table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
      order by table_name, privilege_type`,
);

describe("group 10: coverage guard", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("discovered a non-trivial table list to check", () => {
    expect(rlsRows.length).toBeGreaterThan(10);
  });

  for (const row of rlsRows) {
    it(`"${row.table_name}" has row level security enabled`, () => {
      expect(row.rowsecurity).toBe(true);
    });
  }

  it("anon has zero grants on any public table", () => {
    expect(anonGrants).toEqual([]);
  });
});
