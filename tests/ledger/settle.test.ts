// Unit tests for settleRound — amounts, idempotency, and the missing-
// confirmation error path.
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

describe("settleRound", () => {
  let fixtures: LedgerFixtures;

  beforeAll(async () => {
    fixtures = await ensureLedgerFixtures();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("host + one guest member: host credited 1, guest debited 1", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-a-v2: host + one guest member",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberB }],
    });
    await withTransaction((tx) => settleRound(tx, roundId));

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(2);

    const hostEntry = entries.find((e) => e.userId === fixtures.memberA)!;
    const guestEntry = entries.find((e) => e.userId === fixtures.memberB)!;
    expect(hostEntry.direction).toBe("credit");
    expect(hostEntry.amount).toBe(1);
    expect(guestEntry.direction).toBe("debit");
    expect(guestEntry.amount).toBe(1);
  });

  it("host + two guest members: host credited 2, each guest debited 1", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-b: host + two guest members",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberC }, { userId: fixtures.memberD }],
    });
    await withTransaction((tx) => settleRound(tx, roundId));

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(3);

    const hostEntry = entries.find((e) => e.userId === fixtures.memberA)!;
    expect(hostEntry.direction).toBe("credit");
    expect(hostEntry.amount).toBe(2);
    for (const guestId of [fixtures.memberC, fixtures.memberD]) {
      const entry = entries.find((e) => e.userId === guestId)!;
      expect(entry.direction).toBe("debit");
      expect(entry.amount).toBe(1);
    }
  });

  it("host + one guest member with one plus-one: guest debited 2, host credited 2", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-c: host + one guest with one plus-one",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberB, plusOnes: 1 }],
    });
    await withTransaction((tx) => settleRound(tx, roundId));

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(2);

    const hostEntry = entries.find((e) => e.userId === fixtures.memberA)!;
    const guestEntry = entries.find((e) => e.userId === fixtures.memberB)!;
    expect(hostEntry.amount).toBe(2);
    expect(guestEntry.amount).toBe(2);
  });

  it("host + two guest members each with a plus-one: host credited 4", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-d: host + two guests each with a plus-one",
      hostId: fixtures.memberA,
      guests: [
        { userId: fixtures.memberC, plusOnes: 1 },
        { userId: fixtures.memberD, plusOnes: 1 },
      ],
    });
    await withTransaction((tx) => settleRound(tx, roundId));

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(3);

    const hostEntry = entries.find((e) => e.userId === fixtures.memberA)!;
    expect(hostEntry.amount).toBe(4);
    for (const guestId of [fixtures.memberC, fixtures.memberD]) {
      const entry = entries.find((e) => e.userId === guestId)!;
      expect(entry.amount).toBe(2);
    }
  });

  it("settle twice is a no-op, not a duplicate or an error", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-settle-noop: settle twice",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberE }],
    });

    // The exact status of the *first* call depends on whether this suite
    // has run before against this permanent round (see harness.ts) — on
    // a fresh round it's "settled", on a rerun it's already
    // "already_settled". Either is a valid no-op start; what matters is
    // that after it, the round is settled and the *second* call is
    // deterministically a no-op.
    const first = await withTransaction((tx) => settleRound(tx, roundId));
    expect(["settled", "already_settled"]).toContain(first.status);

    const second = await withTransaction((tx) => settleRound(tx, roundId));
    expect(second.status).toBe("already_settled");

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toHaveLength(2);
  });

  it("settle raises when confirmations are missing", async () => {
    const { roundId } = await findOrCreateRound({
      marker: "scenario-unconfirmed: missing guest confirmation",
      hostId: fixtures.memberA,
      guests: [{ userId: fixtures.memberB }],
      guestConfirmed: false,
    });

    await expect(withTransaction((tx) => settleRound(tx, roundId))).rejects.toMatchObject({
      code: "ROUND_NOT_CONFIRMED",
    });

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.roundId, roundId));
    expect(entries).toEqual([]);
  });
});
