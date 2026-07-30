// withdrawOffer and rejectOffer — host-only / owner-only, idempotent
// from their one live starting state.
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { makeOffer, rejectOffer, withdrawOffer, type Tx } from "@/lib/offers";
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

async function makeLiveOffer(
  tx: Tx,
  requesterId: string,
  hostId: string,
): Promise<{ offerId: string; requestId: string }> {
  const clubId = await createClub(tx);
  const courseId = await createCourse(tx, clubId);
  await setMembership(tx, hostId, clubId, "club_confirmed");
  const requestId = await createOpenRequest(tx, requesterId, [clubId]);
  const { offerId } = await makeOffer(tx, hostId, requestId, {
    clubId,
    courseId,
    teeAtLocal: localTeeTime(11),
    teeTimezone: "Europe/Dublin",
  });
  return { offerId, requestId };
}

describe("withdrawOffer", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("host only, only from 'offered'; idempotent when already withdrawn", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { offerId } = await makeLiveOffer(tx, fixtures.requesterA, fixtures.hostA);

      await expect(withdrawOffer(tx, fixtures.requesterA, offerId)).rejects.toMatchObject({ code: "NOT_HOST" });

      await withdrawOffer(tx, fixtures.hostA, offerId);
      const [offer] = await tx.select().from(schema.offers).where(eq(schema.offers.id, offerId));
      expect(offer.state).toBe("withdrawn");

      // Idempotent no-op, not an error.
      await withdrawOffer(tx, fixtures.hostA, offerId);
    });
  });
});

describe("rejectOffer", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("request owner only, only from 'offered'; idempotent when already declined", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { offerId } = await makeLiveOffer(tx, fixtures.requesterA, fixtures.hostA);

      await expect(rejectOffer(tx, fixtures.hostA, offerId)).rejects.toMatchObject({ code: "NOT_OWNER" });

      await rejectOffer(tx, fixtures.requesterA, offerId, "not this time");
      const [offer] = await tx.select().from(schema.offers).where(eq(schema.offers.id, offerId));
      expect(offer.state).toBe("declined");

      // Idempotent no-op, not an error.
      await rejectOffer(tx, fixtures.requesterA, offerId);
    });
  });
});
