// Group 1 — anon reaches nothing.
//
// The table list is discovered at runtime via information_schema, not
// hardcoded, so a new table added to the public schema without RLS shows
// up here automatically instead of silently being skipped.
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db, supaAnon } from "./harness";

const tableRows = await db.execute<{ table_name: string }>(
  sql`select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
);
const tableNames = tableRows.map((row) => row.table_name);

describe("group 1: anon reaches nothing", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("discovered a non-trivial table list to check", () => {
    // Guards against the introspection query silently returning nothing
    // and this whole group passing vacuously.
    expect(tableNames.length).toBeGreaterThan(10);
    expect(tableNames).toContain("ledger_entries");
    expect(tableNames).toContain("profiles");
  });

  for (const table of tableNames) {
    it(`anon gets zero rows or an error from "${table}"`, async () => {
      const anon = supaAnon();
      const { data, error } = await anon.from(table).select("*").limit(1);
      if (!error) {
        expect(data).toEqual([]);
      }
    });
  }
});
