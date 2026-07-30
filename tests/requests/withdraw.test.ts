// withdrawRequest — owner-only, idempotent on repeat.
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createRequest, withdrawRequest } from "@/lib/requests";
import { closeDb, createClub, ensureRequestFixtures, futureDate, runAndRollback, setMembership } from "./harness";

describe("withdrawRequest", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("fails for a non-owner", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");

      const { requestId } = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [club],
      });

      await expect(withdrawRequest(tx, fixtures.memberB, requestId)).rejects.toMatchObject({
        code: "NOT_OWNER",
      });

      const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId));
      expect(request.state).toBe("open");
    });
  });

  it("twice is a no-op", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");

      const { requestId } = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [club],
      });

      await withdrawRequest(tx, fixtures.memberA, requestId);
      const [afterFirst] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId));
      expect(afterFirst.state).toBe("withdrawn");

      await withdrawRequest(tx, fixtures.memberA, requestId);
      const [afterSecond] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId));
      expect(afterSecond.state).toBe("withdrawn");

      const events = await tx
        .select()
        .from(schema.domainEvents)
        .where(
          and(
            eq(schema.domainEvents.entity, "request"),
            eq(schema.domainEvents.entityId, requestId),
            eq(schema.domainEvents.kind, "request.withdrawn"),
          ),
        );
      expect(events).toHaveLength(1); // emitted once, not again on the no-op call
    });
  });
});
