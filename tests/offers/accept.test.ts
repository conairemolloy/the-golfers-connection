// acceptOffer — round/participants/thread creation, plus-one handling,
// ownership, and design decision 2 (accepting one offer leaves the
// request open).
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { acceptOffer, makeOffer } from "@/lib/offers";
import {
  closeDb,
  createClub,
  createCourse,
  createOpenRequest,
  ensureOfferFixtures,
  localTeeTime,
  runAndRollback,
  setMembership,
} from "./harness";

describe("acceptOffer", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("creates the round, participants and thread with the right membership; plus-ones get invited_by set and no thread access", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);
      const { offerId } = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11, "10:30:00"),
        teeTimezone: "Europe/Dublin",
      });

      const { roundId, threadId } = await acceptOffer(tx, fixtures.requesterA, offerId, {
        plusOnes: ["Jim Smith", "Pat Byrne"],
      });

      const [offer] = await tx.select().from(schema.offers).where(eq(schema.offers.id, offerId));
      expect(offer.state).toBe("accepted");

      const [round] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
      expect(round.offerId).toBe(offerId);
      expect(round.courseId).toBe(courseId);
      expect(round.hostId).toBe(fixtures.hostA);
      expect(round.playedOn).toBe(localTeeTime(11).slice(0, 10));

      const participants = await tx
        .select()
        .from(schema.roundParticipants)
        .where(eq(schema.roundParticipants.roundId, roundId));
      expect(participants).toHaveLength(4); // host + requester + 2 plus-ones

      const host = participants.find((p) => p.userId === fixtures.hostA)!;
      expect(host.role).toBe("host");
      expect(host.isMember).toBe(true);

      const guest = participants.find((p) => p.userId === fixtures.requesterA)!;
      expect(guest.role).toBe("guest");
      expect(guest.isMember).toBe(true);

      const plusOnes = participants.filter((p) => p.userId === null);
      expect(plusOnes).toHaveLength(2);
      for (const plusOne of plusOnes) {
        expect(plusOne.isMember).toBe(false);
        expect(plusOne.role).toBe("guest");
        expect(plusOne.invitedBy).toBe(fixtures.requesterA);
        expect(plusOne.guestName).toBeTruthy();
      }

      const [thread] = await tx.select().from(schema.threads).where(eq(schema.threads.id, threadId));
      expect(thread.kind).toBe("round");
      expect(thread.subjectId).toBe(roundId);

      const threadMembers = await tx
        .select()
        .from(schema.threadMembers)
        .where(eq(schema.threadMembers.threadId, threadId));
      const threadMemberIds = threadMembers.map((m) => m.userId).sort();
      expect(threadMemberIds).toEqual([fixtures.hostA, fixtures.requesterA].sort());

      const acceptedEvents = await tx
        .select()
        .from(schema.domainEvents)
        .where(and(eq(schema.domainEvents.kind, "offer.accepted"), eq(schema.domainEvents.entityId, offerId)));
      expect(acceptedEvents).toHaveLength(1);

      const createdEvents = await tx
        .select()
        .from(schema.domainEvents)
        .where(and(eq(schema.domainEvents.kind, "round.created"), eq(schema.domainEvents.entityId, roundId)));
      expect(createdEvents).toHaveLength(1);
    });
  });

  it("leaves the request 'open' after one offer is accepted", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);
      const { offerId } = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11),
        teeTimezone: "Europe/Dublin",
      });

      await acceptOffer(tx, fixtures.requesterA, offerId);

      const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId));
      expect(request.state).toBe("open");
    });
  });

  it("a non-owner cannot accept", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);
      const { offerId } = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11),
        teeTimezone: "Europe/Dublin",
      });

      await expect(acceptOffer(tx, fixtures.requesterB, offerId)).rejects.toMatchObject({ code: "NOT_OWNER" });
    });
  });
});
