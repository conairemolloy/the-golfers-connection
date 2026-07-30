import { afterAll, describe, expect, it } from "vitest";
import { AvailabilityError, deactivateAvailability, declareAvailability, matchAvailabilityToRequests } from "@/lib/availability";
import { declineToHost, makeOffer } from "@/lib/offers";
import { closeDb, createClub, createCourse, createOpenRequest, ensureAvailabilityFixtures, futureDate, runAndRollback, setMembership } from "./harness";

describe("matchAvailabilityToRequests", () => {
  afterAll(closeDb);

  it("throws for an availability id that does not exist", async () => {
    await runAndRollback(async (tx) => {
      await expect(matchAvailabilityToRequests(tx, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
        AvailabilityError,
      );
    });
  });

  it("returns the open requests a new window could serve, with the same exclusions matchRequestToAvailability applies", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA, requesterB } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const courseId = await createCourse(tx, clubId);
      const otherClubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 3, capacity: 2 });

      // Fits: open, targets the right club, within capacity.
      const fittingRequestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      // Excluded: targets a different club entirely.
      await createOpenRequest(tx, requesterB, [otherClubId], { partySize: 1 });

      // Excluded: party size exceeds the window's capacity.
      await createOpenRequest(tx, requesterB, [clubId], { partySize: 4 });

      // Excluded: the host's own request.
      await createOpenRequest(tx, hostA, [clubId], { partySize: 1 });

      // Excluded: the host already has a live offer on this one.
      const liveOfferRequestId = await createOpenRequest(tx, requesterB, [clubId], { partySize: 1 });
      await makeOffer(tx, hostA, liveOfferRequestId, {
        clubId,
        courseId,
        teeAtLocal: `${futureDate(11)}T09:00`,
        teeTimezone: "Europe/Dublin",
      });

      // Excluded: the host already declined this one.
      const declinedRequestId = await createOpenRequest(tx, requesterB, [clubId], { partySize: 1 });
      await declineToHost(tx, hostA, declinedRequestId, { reason: "dates_dont_suit" });

      const matches = await matchAvailabilityToRequests(tx, availabilityId);

      expect(matches.map((m) => m.requestId)).toEqual([fittingRequestId]);
    });
  });

  it("returns nothing for an inactive window", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 3, capacity: 2 });

      await createOpenRequest(tx, requesterA, [clubId], { partySize: 1 });

      await deactivateAvailability(tx, hostA, availabilityId);

      const matches = await matchAvailabilityToRequests(tx, availabilityId);

      expect(matches).toHaveLength(0);
    });
  });
});
