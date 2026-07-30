// expireRequests + an accepted offer — a request with a committed round
// closes as 'filled', not 'expired', when it lapses past expires_at,
// and does not count against the unfilled (Access Index) total.
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { expireRequests } from "@/lib/requests";
import { buildAcceptedRound, closeDb, createOpenRequest, ensureOfferFixtures, runAndRollback } from "./harness";

describe("expireRequests with an accepted offer", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("marks the request 'filled', not 'expired', and it is not counted unfilled", async () => {
    const fixtures = await ensureOfferFixtures();
    await runAndRollback(async (tx) => {
      const { requestId } = await buildAcceptedRound(tx, {
        requesterId: fixtures.requesterA,
        hostId: fixtures.hostA,
      });

      // A second, genuinely unfilled request in the same rolled-back
      // transaction, so this test's own expectations don't depend on
      // exact global counts (see tests/requests/expire.test.ts for why
      // expireRequests is deliberately global).
      const unfilledClub = await tx
        .insert(schema.clubs)
        .values({
          name: "ZZ Offers Fixture — unrelated unfilled club",
          region: "Fixture Region",
          country: "IE",
          tier: 2,
          accessDifficulty: 1,
          lat: 53.35,
          lng: -6.26,
          timezone: "Europe/Dublin",
        })
        .returning();
      const unfilledRequestId = await createOpenRequest(tx, fixtures.requesterB, [unfilledClub[0].id]);

      const past = new Date(Date.now() - 60_000);
      await tx.update(schema.requests).set({ expiresAt: past }).where(eq(schema.requests.id, requestId));
      await tx.update(schema.requests).set({ expiresAt: past }).where(eq(schema.requests.id, unfilledRequestId));

      const result = await expireRequests(tx);
      expect(result.filledCount).toBeGreaterThanOrEqual(1);
      expect(result.expiredCount).toBeGreaterThanOrEqual(1);
      expect(result.unfilledCount).toBeGreaterThanOrEqual(1);

      const [acceptedRow] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId));
      expect(acceptedRow.state).toBe("filled");

      const [unfilledRow] = await tx.select().from(schema.requests).where(eq(schema.requests.id, unfilledRequestId));
      expect(unfilledRow.state).toBe("expired");

      const filledEvents = await tx
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.kind, "request.filled"));
      const filledEvent = filledEvents.find((e) => e.entityId === requestId);
      expect(filledEvent).toBeDefined();

      const expiredEvents = await tx
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.kind, "request.expired"));
      const unfilledEvent = expiredEvents.find((e) => e.entityId === unfilledRequestId)!;
      expect(unfilledEvent).toBeDefined();
      const payload = unfilledEvent.payload as { unfilled: boolean };
      expect(payload.unfilled).toBe(true);

      // No request.expired event was emitted for the accepted-offer request.
      const wrongEvent = expiredEvents.find((e) => e.entityId === requestId);
      expect(wrongEvent).toBeUndefined();
    });
  });
});
