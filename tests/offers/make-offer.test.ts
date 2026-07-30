// makeOffer — preconditions, the decision-1 no-standing-check guarantee,
// and the warn-but-allow outsideRequestedDates result.
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { makeOffer } from "@/lib/offers";
import {
  closeDb,
  createClub,
  createCourse,
  createOpenRequest,
  ensureOfferFixtures,
  localTeeTime,
  runAndRollback,
  setBalance,
  setMembership,
} from "./harness";

describe("makeOffer", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("succeeds when every precondition is met", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      const result = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11),
        teeTimezone: "Europe/Dublin",
      });

      expect(result.offerId).toBeTruthy();
      expect(result.outsideRequestedDates).toBe(false);

      const [offer] = await tx.select().from(schema.offers).where(eq(schema.offers.id, result.offerId));
      expect(offer.state).toBe("offered");

      const events = await tx
        .select()
        .from(schema.domainEvents)
        .where(and(eq(schema.domainEvents.kind, "offer.made"), eq(schema.domainEvents.entityId, result.offerId)));
      expect(events).toHaveLength(1);
    });
  });

  it("rejects for a non-target club", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const targetClubId = await createClub(tx);
      const otherClubId = await createClub(tx);
      const otherCourseId = await createCourse(tx, otherClubId);
      await setMembership(tx, fixtures.hostA, otherClubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [targetClubId]);

      await expect(
        makeOffer(tx, fixtures.hostA, requestId, {
          clubId: otherClubId,
          courseId: otherCourseId,
          teeAtLocal: localTeeTime(11),
          teeTimezone: "Europe/Dublin",
        }),
      ).rejects.toMatchObject({ code: "CLUB_NOT_TARGETED" });
    });
  });

  it("rejects when the host has no confirmed membership at that club", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      // No membership at all for hostA here.
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      await expect(
        makeOffer(tx, fixtures.hostA, requestId, {
          clubId,
          courseId,
          teeAtLocal: localTeeTime(11),
          teeTimezone: "Europe/Dublin",
        }),
      ).rejects.toMatchObject({ code: "NO_CONFIRMED_MEMBERSHIP" });
    });
  });

  it("rejects a course belonging to a different club", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const otherClubId = await createClub(tx);
      const wrongCourseId = await createCourse(tx, otherClubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      await expect(
        makeOffer(tx, fixtures.hostA, requestId, {
          clubId,
          courseId: wrongCourseId,
          teeAtLocal: localTeeTime(11),
          teeTimezone: "Europe/Dublin",
        }),
      ).rejects.toMatchObject({ code: "COURSE_CLUB_MISMATCH" });
    });
  });

  it("rejects the requester offering on their own request", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.requesterA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      await expect(
        makeOffer(tx, fixtures.requesterA, requestId, {
          clubId,
          courseId,
          teeAtLocal: localTeeTime(11),
          teeTimezone: "Europe/Dublin",
        }),
      ).rejects.toMatchObject({ code: "OWN_REQUEST" });
    });
  });

  it("rejects a second live offer from the same host, but allows re-offering after withdrawal", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      const first = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11),
        teeTimezone: "Europe/Dublin",
      });
      expect(first.offerId).toBeTruthy();

      await expect(
        makeOffer(tx, fixtures.hostA, requestId, {
          clubId,
          courseId,
          teeAtLocal: localTeeTime(11, "14:00:00"),
          teeTimezone: "Europe/Dublin",
        }),
      ).rejects.toMatchObject({ code: "DUPLICATE_LIVE_OFFER" });

      await tx.update(schema.offers).set({ state: "withdrawn" }).where(eq(schema.offers.id, first.offerId));

      const second = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11, "14:00:00"),
        teeTimezone: "Europe/Dublin",
      });
      expect(second.offerId).toBeTruthy();
      expect(second.offerId).not.toBe(first.offerId);
    });
  });

  it("SUCCEEDS for a host whose standing is 'closed' — hosting is never gated on standing", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      await setBalance(tx, fixtures.hostA, -5); // well past the -2 'closed' threshold

      const result = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(11),
        teeTimezone: "Europe/Dublin",
      });
      expect(result.offerId).toBeTruthy();
    });
  });

  it("returns outsideRequestedDates true when the tee time is outside the request's range, and still creates the offer", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const clubId = await createClub(tx);
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, fixtures.hostA, clubId, "club_confirmed");
      // Request wants clubId between day 10 and day 12.
      const requestId = await createOpenRequest(tx, fixtures.requesterA, [clubId]);

      const result = await makeOffer(tx, fixtures.hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: localTeeTime(30), // well outside 10-12
        teeTimezone: "Europe/Dublin",
      });

      expect(result.outsideRequestedDates).toBe(true);
      const [offer] = await tx.select().from(schema.offers).where(eq(schema.offers.id, result.offerId));
      expect(offer.state).toBe("offered");
    });
  });
});
