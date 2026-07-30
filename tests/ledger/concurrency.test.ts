// The confirm race: two settleRound calls for the same round, on two
// genuinely separate connections, running at the same time.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { settleRound } from "@/lib/ledger";
import {
  closeDb,
  db,
  ensureLedgerFixtures,
  findOrCreateRound,
  type LedgerFixtures,
  withTransaction,
} from "./harness";

describe("settleRound concurrency", () => {
  let fixtures: LedgerFixtures;

  beforeAll(async () => {
    fixtures = await ensureLedgerFixtures();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("two parallel settleRound calls for the same round produce exactly one set of entries", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-concurrency: confirm race",
      hostId: fixtures.memberC,
      guests: [{ userId: fixtures.memberD }],
    });

    // withTransaction acquires its own connection per call, and
    // settleRound's SELECT ... FOR UPDATE row lock serializes the two at
    // the database level — whichever loses the race blocks until the
    // winner commits, then sees settled_at already set. Run with
    // Promise.all, not sequential awaits, so this is an actual race, not
    // a simulated one. (On a rerun of the whole suite, the round is
    // already settled from a prior run, so both calls may come back
    // "already_settled" — the invariant that must hold either way is
    // "no error, and exactly one set of entries exists".)
    const [a, b] = await Promise.all([
      withTransaction((tx) => settleRound(tx, roundId)),
      withTransaction((tx) => settleRound(tx, roundId)),
    ]);

    for (const result of [a, b]) {
      expect(["settled", "already_settled"]).toContain(result.status);
    }

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(2);
  });
});
