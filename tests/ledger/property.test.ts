// Property test: memberBalance() must always equal the sum of a
// member's credits minus debits, read directly from ledger_entries, no
// matter what sequence of settlements and reversals produced them. This
// is the invariant that must never break.
//
// Deterministic (seeded PRNG, not Math.random()): the same seed produces
// the same sequence of rounds every run, and findOrCreateRound is
// idempotent by marker, so reruns don't grow the fixture set — they just
// re-verify the same permanent data.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { LedgerError, memberBalance, reverseRound, settleRound } from "@/lib/ledger";
import {
  closeDb,
  db,
  ensureLedgerFixtures,
  findOrCreateRound,
  type LedgerFixtures,
  propertyIterationMarker,
  withTransaction,
} from "./harness";

const SEED = 424242;
const ITERATIONS = 100;

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

describe("ledger property: balance always equals sum of entries", () => {
  let fixtures: LedgerFixtures;

  beforeAll(async () => {
    fixtures = await ensureLedgerFixtures();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it(
    `holds across ${ITERATIONS} random settle/reverse iterations over several members`,
    async () => {
      const pool = [fixtures.memberA, fixtures.memberB, fixtures.memberC, fixtures.memberD, fixtures.memberE];
      const rand = mulberry32(SEED);

      for (let i = 0; i < ITERATIONS; i++) {
        const order = shuffle(pool, rand);
        const hostId = order[0];
        const guestCount = 1 + Math.floor(rand() * 2); // 1 or 2
        const guestIds = order.slice(1, 1 + guestCount);
        const guests = guestIds.map((userId) => ({
          userId,
          plusOnes: rand() < 0.4 ? 1 : 0,
        }));

        const { roundId } = await findOrCreateRound({
          marker: propertyIterationMarker(SEED, i),
          hostId,
          guests,
        });

        // Deterministic seed means a rerun replays the exact same
        // settle/reverse decision for this iteration every time — but a
        // round this run's replay decides to reverse was *also* reversed
        // on every prior run, and a reversed round is terminal: settling
        // it again correctly raises ROUND_REVERSED. That's not a bug to
        // work around at the settleRound level (it's the invariant this
        // whole suite exists to enforce) — it just means this loop, to
        // stay rerun-safe, has to recognise "already terminal" and stop
        // for this iteration rather than treat the raise as a failure.
        let reversedByPriorRun = false;
        try {
          await withTransaction((tx) => settleRound(tx, roundId));
        } catch (err) {
          if (err instanceof LedgerError && err.code === "ROUND_REVERSED") {
            reversedByPriorRun = true;
          } else {
            throw err;
          }
        }

        if (!reversedByPriorRun && rand() < 0.3) {
          await withTransaction((tx) => reverseRound(tx, roundId, `property test iteration ${i}`));
        }
      }

      for (const userId of pool) {
        const viaFunction = await withTransaction((tx) => memberBalance(tx, userId));

        const rows = await db
          .select()
          .from(schema.ledgerEntries)
          .where(eq(schema.ledgerEntries.userId, userId));
        const viaRawSum = rows.reduce(
          (sum, row) => sum + (row.direction === "credit" ? row.amount : -row.amount),
          0,
        );

        expect(viaFunction).toBe(viaRawSum);
      }
    },
    180_000,
  );
});
