// Unit tests for reverseRound — compensating entries, idempotency, and
// the terminal "cannot re-settle a reversed round" rule.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { LedgerError, reverseRound, settleRound } from "@/lib/ledger";
import {
  closeDb,
  db,
  ensureLedgerFixtures,
  findOrCreateRound,
  type LedgerFixtures,
  withTransaction,
} from "./harness";

describe("reverseRound", () => {
  let fixtures: LedgerFixtures;
  let roundId: string;

  beforeAll(async () => {
    fixtures = await ensureLedgerFixtures();
    ({ roundId } = await findOrCreateRound({
      marker: "scenario-reverse: host + one guest, later reversed",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberE }],
    }));
    try {
      await withTransaction((tx) => settleRound(tx, roundId));
    } catch (err) {
      // On a rerun this round may already have been reversed by a
      // previous run's "produces exact compensating entries" test below
      // — that's the state every test in this file wants anyway, so
      // treat it as already set up rather than a setup failure.
      if (!(err instanceof LedgerError) || err.code !== "ROUND_REVERSED") {
        throw err;
      }
    }
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("raises when the round has not been settled", async () => {
    const { roundId: unsettledRoundId } = await findOrCreateRound({
      marker: "scenario-reverse-unsettled: confirmed but never settled",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberC }],
    });

    await expect(
      withTransaction((tx) => reverseRound(tx, unsettledRoundId, "should not be reachable")),
    ).rejects.toMatchObject({ code: "ROUND_NOT_SETTLED" });
  });

  it("produces exact compensating entries and sets reversed_at", async () => {
    // Asserts final state rather than a before/after delta: on a rerun
    // this round may already be reversed (from a previous run of this
    // very test), in which case this call is itself a no-op — the state
    // it leaves behind is what matters, not whether *this* call was the
    // one that produced it.
    const result = await withTransaction((tx) => reverseRound(tx, roundId, "test reversal"));
    expect(["reversed", "already_reversed"]).toContain(result.status);

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(4); // 2 original (settle) + 2 compensating (reverse)

    const byUserDirection = new Map(entries.map((e) => [`${e.userId}:${e.direction}`, e]));
    const hostCredit = byUserDirection.get(`${fixtures.memberA}:credit`)!;
    const hostDebit = byUserDirection.get(`${fixtures.memberA}:debit`)!;
    const guestDebit = byUserDirection.get(`${fixtures.memberE}:debit`)!;
    const guestCredit = byUserDirection.get(`${fixtures.memberE}:credit`)!;

    expect(hostCredit).toBeDefined();
    expect(hostDebit).toBeDefined();
    expect(guestDebit).toBeDefined();
    expect(guestCredit).toBeDefined();
    expect(hostCredit.amount).toBe(1);
    expect(hostDebit.amount).toBe(1);
    expect(guestDebit.amount).toBe(1);
    expect(guestCredit.amount).toBe(1);
    expect(hostDebit.reason.startsWith("REVERSAL: ")).toBe(true);
    expect(guestCredit.reason.startsWith("REVERSAL: ")).toBe(true);

    const [round] = await db.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
    // Terminal per the decision log: reversed_at is the new marker,
    // settled_at is left as-is rather than cleared.
    expect(round.reversedAt).not.toBeNull();
    expect(round.settledAt).not.toBeNull();
  });

  it("reverse twice is a no-op", async () => {
    const before = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));

    const result = await withTransaction((tx) => reverseRound(tx, roundId, "test reversal again"));
    expect(result.status).toBe("already_reversed");

    const after = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(after).toHaveLength(before.length);
  });

  it("a reversed round cannot be settled again", async () => {
    await expect(withTransaction((tx) => settleRound(tx, roundId))).rejects.toMatchObject({
      code: "ROUND_REVERSED",
    });
  });
});
