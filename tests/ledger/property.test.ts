// Property test: memberBalance() must always equal the sum of a
// member's credits minus debits, read directly from ledger_entries, no
// matter what sequence of settlements and reversals produced them. This
// is the invariant that must never break.
//
// Runs inside a single transaction that is rolled back at the end (via
// tx.rollback(), never committed) — the ledger is append-only, so
// anything this test wrote would otherwise be permanent. ROLLBACK is
// safe against the append-only trigger: ledger_entries_no_update_or_delete
// (0003_ledger_immutability.sql) fires on UPDATE and DELETE statements
// specifically. ROLLBACK is transaction control, neither of those — the
// trigger never sees it, Postgres just discards the whole transaction's
// effects.
//
// One consequence worth being explicit about: this test never exercises
// the *committed* path. The unique constraints on ledger_entries
// (idempotency_key, and (round_id, user_id, direction)) are exercised
// within this one transaction, but never across separate, concurrently
// committing ones — that's what tests/ledger/concurrency.test.ts is for.
// Do not treat a pass here as proof of cross-transaction safety.
//
// Deterministic (seeded PRNG, not Math.random()) so a failure is
// reproducible. Unlike the fixture-based scenario tests, this needs no
// idempotency bookkeeping to stay rerun-safe — nothing survives past the
// rollback, so "a previous run already did this" can never be true, and
// there's nothing to find-or-create (see buildEphemeralRound).
import { TransactionRollbackError, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { memberBalance, reverseRound, settleRound } from "@/lib/ledger";
import { buildEphemeralRound, closeDb, ensureClubAndCourse, ensureLedgerFixtures, withTransaction } from "./harness";

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
  afterAll(async () => {
    await closeDb();
  });

  it(
    `holds across ${ITERATIONS} random settle/reverse iterations over several members`,
    async () => {
      const fixtures = await ensureLedgerFixtures();
      const { clubId, courseId } = await ensureClubAndCourse();
      const pool = [fixtures.memberA, fixtures.memberB, fixtures.memberC, fixtures.memberD, fixtures.memberE];
      const rand = mulberry32(SEED);

      const rolledBack = withTransaction(async (tx) => {
        for (let i = 0; i < ITERATIONS; i++) {
          const order = shuffle(pool, rand);
          const hostId = order[0];
          const guestCount = 1 + Math.floor(rand() * 2); // 1 or 2
          const guestIds = order.slice(1, 1 + guestCount);
          // Drawn unconditionally, every iteration, regardless of
          // anything else — a shared PRNG plus a short-circuited draw
          // desyncs every later iteration from what a previous run saw.
          // Draw first, decide after.
          const shouldReverse = rand() < 0.3;
          const guests = guestIds.map((userId) => ({
            userId,
            plusOnes: rand() < 0.4 ? 1 : 0,
          }));

          const { roundId } = await buildEphemeralRound(tx, { hostId, guests, clubId, courseId });

          await settleRound(tx, roundId);
          if (shouldReverse) {
            await reverseRound(tx, roundId, `property test iteration ${i}`);
          }
        }

        for (const userId of pool) {
          const viaFunction = await memberBalance(tx, userId);

          const rows = await tx
            .select()
            .from(schema.ledgerEntries)
            .where(eq(schema.ledgerEntries.userId, userId));
          const viaRawSum = rows.reduce(
            (sum, row) => sum + (row.direction === "credit" ? row.amount : -row.amount),
            0,
          );

          expect(viaFunction).toBe(viaRawSum);
        }

        tx.rollback();
      });

      // tx.rollback() throws TransactionRollbackError to force the
      // ROLLBACK; withTransaction's promise rejects with it in turn.
      // That's success here, not a failure — assert-then-rollback is the
      // whole design, so a rejection with anything else is a real error.
      await expect(rolledBack).rejects.toBeInstanceOf(TransactionRollbackError);
    },
    180_000,
  );
});
