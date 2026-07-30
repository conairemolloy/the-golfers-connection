// expireRequests — the state transition matters less than the payload:
// unfilled requests are the Access Index and the evidence for club-side
// release.
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createRequest, expireRequests } from "@/lib/requests";
import { closeDb, createClub, createCourse, ensureRequestFixtures, futureDate, runAndRollback, setMembership } from "./harness";

describe("expireRequests", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("marks the right rows and emits payloads with the unfilled flag correct in both directions", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      const course = await createCourse(tx, club);
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");
      await setMembership(tx, fixtures.memberB, club, "club_confirmed");

      // Past-due and unfilled — no offer.
      const unfilled = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [club],
      });

      // Past-due but filled — has an offer.
      const filled = await createRequest(tx, fixtures.memberB, {
        region: "Munster",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 2,
        targetClubIds: [club],
      });
      await tx.insert(schema.offers).values({
        requestId: filled.requestId,
        hostId: fixtures.memberC,
        clubId: club,
        courseId: course,
        teeAtLocal: new Date("2025-06-05T09:00:00"),
        teeTimezone: "Europe/Dublin",
        state: "offered",
      });

      // Still open, not due yet — must be untouched.
      const stillOpen = await createRequest(tx, fixtures.memberA, {
        region: "Munster",
        dateFrom: futureDate(20),
        dateTo: futureDate(22),
        partySize: 2,
        targetClubIds: [club],
      });

      const past = new Date(Date.now() - 60_000);
      await tx.update(schema.requests).set({ expiresAt: past }).where(eq(schema.requests.id, unfilled.requestId));
      await tx.update(schema.requests).set({ expiresAt: past }).where(eq(schema.requests.id, filled.requestId));

      // expireRequests is deliberately global — it processes every open,
      // overdue request in the table, not just this test's. tests/rls's
      // ephemeral fixtures (open requests with a far-past expires_at,
      // shared for the lifetime of a `pnpm test` run) are legitimately
      // in scope too, so the exact counts here can be higher than 2/1
      // when this file runs as part of the full suite. What "marks the
      // right rows" actually asks for is checked below: this test's own
      // 3 requests end up in exactly the states they should.
      const result = await expireRequests(tx);
      expect(result.expiredCount).toBeGreaterThanOrEqual(2);
      expect(result.unfilledCount).toBeGreaterThanOrEqual(1);

      const [unfilledRow] = await tx.select().from(schema.requests).where(eq(schema.requests.id, unfilled.requestId));
      const [filledRow] = await tx.select().from(schema.requests).where(eq(schema.requests.id, filled.requestId));
      const [stillOpenRow] = await tx.select().from(schema.requests).where(eq(schema.requests.id, stillOpen.requestId));
      expect(unfilledRow.state).toBe("expired");
      expect(filledRow.state).toBe("expired");
      expect(stillOpenRow.state).toBe("open");

      const events = await tx
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.kind, "request.expired"));
      const unfilledEvent = events.find((e) => e.entityId === unfilled.requestId)!;
      const filledEvent = events.find((e) => e.entityId === filled.requestId)!;
      expect(unfilledEvent).toBeDefined();
      expect(filledEvent).toBeDefined();

      const unfilledPayload = unfilledEvent.payload as { unfilled: boolean; targetClubIds: string[] };
      const filledPayload = filledEvent.payload as { unfilled: boolean; targetClubIds: string[] };
      expect(unfilledPayload.unfilled).toBe(true);
      expect(unfilledPayload.targetClubIds).toEqual([club]);
      expect(filledPayload.unfilled).toBe(false);
      expect(filledPayload.targetClubIds).toEqual([club]);
    });
  });
});
