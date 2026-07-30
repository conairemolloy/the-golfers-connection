// createRequest — validation, tier enforcement, standing gate, and the
// expires_at cap.
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createRequest } from "@/lib/requests";
import {
  closeDb,
  createClub,
  ensureRequestFixtures,
  futureDate,
  runAndRollback,
  setBalance,
  setMembership,
} from "./harness";

describe("createRequest", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("succeeds within tier, fails above it", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const hardClub = await createClub(tx, { tier: 1 }); // hardest to access
      const memberClub = await createClub(tx, { tier: 3 }); // member's own tier
      await setMembership(tx, fixtures.memberA, memberClub, "club_confirmed");

      // Within tier: tier 3 (own club) and any tier number >= 3 is fine.
      const { requestId } = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [memberClub],
      });
      expect(requestId).toBeTruthy();

      // Above tier: tier 1 is a harder club than the member's tier 3.
      await expect(
        createRequest(tx, fixtures.memberA, {
          region: "Munster",
          dateFrom: futureDate(10),
          dateTo: futureDate(12),
          partySize: 2,
          targetClubIds: [hardClub],
        }),
      ).rejects.toMatchObject({ code: "CLUB_TIER_TOO_HIGH" });
    });
  });

  it("fails for a member with no confirmed membership", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      // memberA has no membership at all here — not even a declared one.
      await expect(
        createRequest(tx, fixtures.memberA, {
          region: "Munster",
          dateFrom: futureDate(10),
          dateTo: futureDate(12),
          partySize: 2,
          targetClubIds: [club],
        }),
      ).rejects.toMatchObject({ code: "NO_CONFIRMED_MEMBERSHIP" });
    });
  });

  it("fails when standing is 'closed', succeeds at 'owing'", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");
      await setMembership(tx, fixtures.memberB, club, "club_confirmed");

      await setBalance(tx, fixtures.memberA, -3);
      await expect(
        createRequest(tx, fixtures.memberA, {
          region: "Munster",
          dateFrom: futureDate(10),
          dateTo: futureDate(12),
          partySize: 2,
          targetClubIds: [club],
        }),
      ).rejects.toMatchObject({ code: "STANDING_CLOSED" });

      await setBalance(tx, fixtures.memberB, -2);
      const { requestId } = await createRequest(tx, fixtures.memberB, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [club],
      });
      expect(requestId).toBeTruthy();
    });
  });

  it("date validation: past dateFrom rejected, dateTo before dateFrom rejected", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");

      await expect(
        createRequest(tx, fixtures.memberA, {
          region: "Munster",
          dateFrom: futureDate(-5),
          dateTo: futureDate(10),
          partySize: 2,
          targetClubIds: [club],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      await expect(
        createRequest(tx, fixtures.memberA, {
          region: "Munster",
          dateFrom: futureDate(10),
          dateTo: futureDate(5),
          partySize: 2,
          targetClubIds: [club],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  it("expires_at is capped at dateFrom minus one day", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");

      // Near-future trip: dateFrom - 1 day is well inside 90 days, so
      // that's what should apply.
      const { requestId: nearId } = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [club],
      });
      const [nearRequest] = await tx.select().from(schema.requests).where(eq(schema.requests.id, nearId));
      // createRequest anchors dateFrom - 1 day at UTC midnight, not at
      // "now" — match that anchor here, or this drifts by up to a day
      // depending what time of day the suite happens to run.
      const expectedNear = new Date(`${futureDate(10)}T00:00:00Z`);
      expectedNear.setUTCDate(expectedNear.getUTCDate() - 1);
      expect(Math.abs(nearRequest.expiresAt.getTime() - expectedNear.getTime())).toBeLessThan(5_000);

      // Far-future trip: dateFrom - 1 day is past 90 days out, so the
      // 90-day cap applies instead.
      const { requestId: farId } = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(150),
        dateTo: futureDate(152),
        partySize: 2,
        targetClubIds: [club],
      });
      const [farRequest] = await tx.select().from(schema.requests).where(eq(schema.requests.id, farId));
      const expectedFar = new Date();
      expectedFar.setUTCDate(expectedFar.getUTCDate() + 90);
      expect(Math.abs(farRequest.expiresAt.getTime() - expectedFar.getTime())).toBeLessThan(5_000);
    });
  });
});
