// confirmRound and cancelRound — mutual confirmation settling the
// ledger exactly once, and cancellation as the decided (never delete)
// path, before vs after settlement.
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { memberBalance } from "@/lib/ledger";
import { cancelRound, confirmRound } from "@/lib/offers";
import { buildAcceptedRound, closeDb, ensureOfferFixtures, localTeeTime, runAndRollback } from "./harness";

describe("confirmRound", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("one side confirming does not settle; both sides does, with correct ledger amounts including a plus-one", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId, requesterId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        teeAtLocal: localTeeTime(-2),
        plusOnes: ["Guest Plus-One"],
      });

      const first = await confirmRound(tx, hostId, roundId);
      expect(first).toEqual({ status: "confirmed", bothConfirmed: false });

      const [afterHost] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(afterHost.hostConfirmedAt).not.toBeNull();
      expect(afterHost.guestConfirmedAt).toBeNull();
      expect(afterHost.settledAt).toBeNull();

      const entriesAfterOneSide = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.roundId, roundId));
      expect(entriesAfterOneSide).toEqual([]);

      const second = await confirmRound(tx, requesterId, roundId);
      expect(second).toEqual({ status: "confirmed", bothConfirmed: true });

      const [afterBoth] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(afterBoth.guestConfirmedAt).not.toBeNull();
      expect(afterBoth.settledAt).not.toBeNull();

      const entries = await tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.roundId, roundId));
      expect(entries).toHaveLength(2);
      const hostEntry = entries.find((e) => e.userId === hostId)!;
      const guestEntry = entries.find((e) => e.userId === requesterId)!;
      // Host credited once per guest who played: the requester plus their plus-one.
      expect(hostEntry.direction).toBe("credit");
      expect(hostEntry.amount).toBe(2);
      // The requester carries both their own debit and their plus-one's.
      expect(guestEntry.direction).toBe("debit");
      expect(guestEntry.amount).toBe(2);
    });
  });

  it("rejects a round whose played_on is in the future", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        // buildAcceptedRound defaults teeAtLocal to 11 days out.
      });

      await expect(confirmRound(tx, hostId, roundId)).rejects.toMatchObject({ code: "ROUND_IN_FUTURE" });
    });
  });

  it("twice from the same side is a no-op", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        teeAtLocal: localTeeTime(-2),
      });

      const first = await confirmRound(tx, hostId, roundId);
      expect(first.status).toBe("confirmed");

      const [afterFirst] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));

      const second = await confirmRound(tx, hostId, roundId);
      expect(second).toEqual({ status: "already_confirmed" });

      const [afterSecond] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(afterSecond.hostConfirmedAt).toEqual(afterFirst.hostConfirmedAt);

      const events = await tx
        .select()
        .from(schema.domainEvents)
        .where(and(eq(schema.domainEvents.kind, "round.confirmed"), eq(schema.domainEvents.entityId, roundId)));
      expect(events).toHaveLength(1);
    });
  });

  it("rejects confirming a cancelled round", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId, requesterId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        teeAtLocal: localTeeTime(-2),
      });

      await cancelRound(tx, hostId, roundId, "flooding");

      await expect(confirmRound(tx, hostId, roundId)).rejects.toMatchObject({ code: "ROUND_CANCELLED" });
      await expect(confirmRound(tx, requesterId, roundId)).rejects.toMatchObject({ code: "ROUND_CANCELLED" });
    });
  });
});

describe("cancelRound", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("before settlement writes no ledger entries", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId, offerId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        teeAtLocal: localTeeTime(-2),
      });

      const result = await cancelRound(tx, hostId, roundId, "illness");
      expect(result).toEqual({ status: "cancelled" });

      const entries = await tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.roundId, roundId));
      expect(entries).toEqual([]);

      const [round] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(round.cancelledAt).not.toBeNull();
      expect(round.cancelReason).toBe("illness");

      const [offer] = await tx.select().from(schema.offers).where(eq(schema.offers.id, offerId));
      expect(offer.state).toBe("cancelled");
    });
  });

  it("after settlement produces compensating entries and leaves the balance at zero net", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId, requesterId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        teeAtLocal: localTeeTime(-2),
      });

      await confirmRound(tx, hostId, roundId);
      await confirmRound(tx, requesterId, roundId);

      const settledEntries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.roundId, roundId));
      expect(settledEntries).toHaveLength(2);

      const result = await cancelRound(tx, requesterId, roundId, "trip cancelled");
      expect(result).toEqual({ status: "cancelled" });

      const entries = await tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.roundId, roundId));
      expect(entries).toHaveLength(4); // 2 settle + 2 compensating

      const hostBalance = await memberBalance(tx, hostId);
      const requesterBalance = await memberBalance(tx, requesterId);
      // Both members had no other ledger activity in this rolled-back
      // transaction, so a fully reversed round nets to zero for each.
      expect(hostBalance).toBe(0);
      expect(requesterBalance).toBe(0);

      const [round] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(round.reversedAt).not.toBeNull();
      expect(round.cancelledAt).not.toBeNull();
    });
  });

  it("is idempotent", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { roundId, hostId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
        teeAtLocal: localTeeTime(-2),
      });

      const first = await cancelRound(tx, hostId, roundId, "flooding");
      expect(first).toEqual({ status: "cancelled" });

      const second = await cancelRound(tx, hostId, roundId, "flooding again");
      expect(second).toEqual({ status: "already_cancelled" });

      const [round] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(round.cancelReason).toBe("flooding"); // unchanged by the no-op second call
    });
  });
});
