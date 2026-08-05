import { and, notLike, type SQL } from "drizzle-orm";
import * as schema from "@/db/schema";

// Fixture clubs are permanent rows in the dev database, not deletable
// scratch data: tests/rls leaves "ZZ RLS Fixture — ..." / "ZZ Ledger
// Fixture — ..." clubs behind (see tests/rls/harness.ts), and
// tests/e2e/m4-journey.spec.ts creates a fresh "E2E M4 <timestamp> ...
// Club" pair on every run. Nothing ever deletes them — ledger_entries
// is append-only (CLAUDE.md), so a club with settled rounds against it
// can't be torn down without breaking that invariant — which makes
// exclusion at query time the only option. scripts/seed.ts already
// excludes the "ZZ...Fixture — " pattern from its own counts; this is
// the same exclusion, shared so every member-facing club list applies
// it too.
export function excludeFixtureClubs(): SQL {
  return and(notLike(schema.clubs.name, "ZZ%Fixture — %"), notLike(schema.clubs.name, "E2E M4 %"))!;
}
