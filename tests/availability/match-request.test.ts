import { afterAll, describe, expect, it } from "vitest";
import { declareAvailability, deactivateAvailability, matchRequestToAvailability } from "@/lib/availability";
import { declineToHost, makeOffer } from "@/lib/offers";
import {
  closeDb,
  createClub,
  createCourse,
  createOpenRequest,
  ensureAvailabilityFixtures,
  futureDate,
  isoWeekdayOf,
  runAndRollback,
  setMembership,
} from "./harness";

describe("matchRequestToAvailability", () => {
  afterAll(closeDb);

  it("matches a recurring weekday window and returns the specific dates in range", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const dateFrom = futureDate(30);
      const dateTo = futureDate(36); // 7-day span, guarantees every weekday appears exactly once
      const weekday = isoWeekdayOf(dateFrom);
      await declareAvailability(tx, hostA, { clubId, weekday, capacity: 2 });

      const requestId = await createOpenRequest(tx, requesterA, [clubId], { dateFrom, dateTo, partySize: 2 });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(1);
      expect(matches[0].hostId).toBe(hostA);
      expect(matches[0].matchingDates).toEqual([dateFrom]);
    });
  });

  it("matches a bounded window that overlaps the request's range", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      await declareAvailability(tx, hostA, {
        clubId,
        dateFrom: futureDate(10),
        dateTo: futureDate(20),
        capacity: 2,
      });

      const requestId = await createOpenRequest(tx, requesterA, [clubId], {
        dateFrom: futureDate(15),
        dateTo: futureDate(25),
        partySize: 2,
      });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(1);
      expect(matches[0].matchingDates).toBeNull();
    });
  });

  it("does not match a bounded window that does not overlap", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      await declareAvailability(tx, hostA, {
        clubId,
        dateFrom: futureDate(10),
        dateTo: futureDate(15),
        capacity: 2,
      });

      const requestId = await createOpenRequest(tx, requesterA, [clubId], {
        dateFrom: futureDate(20),
        dateTo: futureDate(25),
        partySize: 2,
      });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });

  it("does not match when capacity is below the request's party size", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      await declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 1 });
      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 4 });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });

  it("does not match when min_tier excludes the requester", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const hostClubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, hostClubId, "club_confirmed");
      await declareAvailability(tx, hostA, { clubId: hostClubId, weekday: 2, capacity: 2, minTier: 1 });

      // Requester's tier is derived from the best (lowest-numbered) club
      // he's club_confirmed at — tier 3 here, worse than the window's
      // min_tier of 1, so he should be excluded.
      const requesterClubId = await createClub(tx, { tier: 3 });
      await setMembership(tx, requesterA, requesterClubId, "club_confirmed");

      const requestId = await createOpenRequest(tx, requesterA, [hostClubId], { partySize: 2 });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });

  it("does not match an inactive window", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 2 });
      await deactivateAvailability(tx, hostA, availabilityId);

      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });

  it("does not match the requester's own availability", async () => {
    await runAndRollback(async (tx) => {
      const { requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, requesterA, clubId, "club_confirmed");

      await declareAvailability(tx, requesterA, { clubId, weekday: 2, capacity: 2 });
      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });

  it("does not match a host who already has a live offer on the request", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, hostA, clubId, "club_confirmed");
      await declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 2 });

      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });
      await makeOffer(tx, hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: `${futureDate(11)}T09:00`,
        teeTimezone: "Europe/Dublin",
      });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });

  it("does not match a host who has declined the request", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      await declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 2 });

      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });
      await declineToHost(tx, hostA, requestId, { reason: "not_this_time" });

      const matches = await matchRequestToAvailability(tx, requestId);

      expect(matches).toHaveLength(0);
    });
  });
});
