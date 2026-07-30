import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { hostDeclines } from "@/db/schema";
import { matchRequestToAvailability, declareAvailability } from "@/lib/availability";
import { declineToHost, makeOffer, OfferError } from "@/lib/offers";
import { closeDb, createClub, createCourse, createOpenRequest, ensureAvailabilityFixtures, futureDate, runAndRollback, setMembership } from "./harness";

describe("declineToHost", () => {
  afterAll(closeDb);

  it("records the decline and removes the host from subsequent matches", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      await declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 2 });

      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      expect(await matchRequestToAvailability(tx, requestId)).toHaveLength(1);

      const result = await declineToHost(tx, hostA, requestId, { reason: "not_this_time", note: "not this time round" });
      expect(result.status).toBe("declined");

      expect(await matchRequestToAvailability(tx, requestId)).toHaveLength(0);
    });
  });

  it("is idempotent per (host, request)", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      const first = await declineToHost(tx, hostA, requestId, { reason: "club_too_busy" });
      const second = await declineToHost(tx, hostA, requestId, { reason: "club_too_busy" });

      expect(first.status).toBe("declined");
      expect(second.status).toBe("already_declined");

      const rows = await tx.select().from(hostDeclines).where(eq(hostDeclines.requestId, requestId));
      expect(rows).toHaveLength(1);
    });
  });

  it("accepts and stores a suggested member and date range", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA, requesterB } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      const result = await declineToHost(tx, hostA, requestId, {
        reason: "dates_dont_suit",
        suggestedDateFrom: futureDate(60),
        suggestedDateTo: futureDate(65),
        suggestedMemberId: requesterB,
      });
      expect(result.status).toBe("declined");

      const [row] = await tx.select().from(hostDeclines).where(eq(hostDeclines.requestId, requestId));
      expect(row.suggestedMemberId).toBe(requesterB);
      expect(row.suggestedDateFrom).toBe(futureDate(60));
      expect(row.suggestedDateTo).toBe(futureDate(65));
    });
  });

  it("rejects a suggested member id that is not a member", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA, applicant } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });

      await expect(
        declineToHost(tx, hostA, requestId, { reason: "other", suggestedMemberId: applicant }),
      ).rejects.toMatchObject({ code: "SUGGESTED_MEMBER_NOT_FOUND" });
    });
  });

  it("a host who already has a live offer cannot decline — he should withdraw instead", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, requesterA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const courseId = await createCourse(tx, clubId);
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const requestId = await createOpenRequest(tx, requesterA, [clubId], { partySize: 2 });
      await makeOffer(tx, hostA, requestId, {
        clubId,
        courseId,
        teeAtLocal: `${futureDate(11)}T09:00`,
        teeTimezone: "Europe/Dublin",
      });

      const outcome = declineToHost(tx, hostA, requestId, { reason: "not_this_time" });
      await expect(outcome).rejects.toBeInstanceOf(OfferError);
      await expect(outcome).rejects.toMatchObject({ code: "HAS_LIVE_OFFER" });
    });
  });
});
