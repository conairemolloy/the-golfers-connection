// listBook — the Book as a member sees it: scoped to clubs the viewer
// is confirmed at, never the viewer's own requests, never withdrawn or
// expired ones, and discretion mode masking.
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createRequest, expireRequests, listBook, withdrawRequest } from "@/lib/requests";
import { closeDb, createClub, ensureRequestFixtures, futureDate, runAndRollback, setMembership } from "./harness";

describe("listBook", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("excludes own requests, unconfirmed-club targets, withdrawn, and expired", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const confirmedClub = await createClub(tx, { tier: 2 });
      const otherClub = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, confirmedClub, "club_confirmed"); // viewer
      await setMembership(tx, fixtures.memberB, confirmedClub, "club_confirmed");
      await setMembership(tx, fixtures.memberC, otherClub, "club_confirmed");

      const visible = await createRequest(tx, fixtures.memberB, {
        region: "x",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 1,
        targetClubIds: [confirmedClub],
      });

      const ownRequest = await createRequest(tx, fixtures.memberA, {
        region: "x",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 1,
        targetClubIds: [confirmedClub],
      });

      const unconfirmedTarget = await createRequest(tx, fixtures.memberC, {
        region: "x",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 1,
        targetClubIds: [otherClub],
      });

      const withdrawn = await createRequest(tx, fixtures.memberB, {
        region: "x",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 1,
        targetClubIds: [confirmedClub],
      });
      await withdrawRequest(tx, fixtures.memberB, withdrawn.requestId);

      const expired = await createRequest(tx, fixtures.memberB, {
        region: "x",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 1,
        targetClubIds: [confirmedClub],
      });
      await tx
        .update(schema.requests)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.requests.id, expired.requestId));
      await expireRequests(tx);

      const page = await listBook(tx, fixtures.memberA, {});
      const ids = page.entries.map((e) => e.requestId);

      expect(ids).toContain(visible.requestId);
      expect(ids).not.toContain(ownRequest.requestId);
      expect(ids).not.toContain(unconfirmedTarget.requestId);
      expect(ids).not.toContain(withdrawn.requestId);
      expect(ids).not.toContain(expired.requestId);
    });
  });

  it("returns initials only for a discretion-mode requester", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed");
      await setMembership(tx, fixtures.discretionMember, club, "club_confirmed");
      await tx
        .update(schema.profiles)
        .set({ discretionMode: true })
        .where(eq(schema.profiles.id, fixtures.discretionMember));

      const { requestId } = await createRequest(tx, fixtures.discretionMember, {
        region: "x",
        dateFrom: futureDate(10),
        dateTo: futureDate(12),
        partySize: 1,
        targetClubIds: [club],
      });

      const page = await listBook(tx, fixtures.memberA, {});
      const entry = page.entries.find((e) => e.requestId === requestId)!;
      expect(entry).toBeDefined();
      expect(entry.discretionMode).toBe(true);
      expect(entry.requesterDisplayName).toBeNull();
      expect(entry.requesterInitials).not.toBeNull();
    });
  });

  it("cursor pagination returns each row exactly once across pages", async () => {
    const fixtures = await ensureRequestFixtures();
    await runAndRollback(async (tx) => {
      const club = await createClub(tx, { tier: 2 });
      await setMembership(tx, fixtures.memberA, club, "club_confirmed"); // viewer
      await setMembership(tx, fixtures.memberB, club, "club_confirmed"); // requester

      // Every one of these lands in the same transaction, so Postgres's
      // now() — frozen at transaction start — gives them all an
      // identical created_at. That's exactly the case the (created_at,
      // id) keyset cursor's id tiebreak exists for, so this test
      // exercises that path directly rather than by accident.
      const created: string[] = [];
      for (let i = 0; i < 23; i++) {
        const { requestId } = await createRequest(tx, fixtures.memberB, {
          region: "x",
          dateFrom: futureDate(10),
          dateTo: futureDate(12),
          partySize: 1,
          targetClubIds: [club],
        });
        created.push(requestId);
      }

      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      let hasMore = true;
      while (hasMore && pages < 20) {
        const page = await listBook(tx, fixtures.memberA, { limit: 7, cursor });
        for (const entry of page.entries) {
          expect(seen.has(entry.requestId)).toBe(false);
          seen.add(entry.requestId);
        }
        hasMore = page.nextCursor !== null;
        cursor = page.nextCursor ?? undefined;
        pages++;
      }

      expect(seen.size).toBe(created.length);
      for (const id of created) {
        expect(seen.has(id)).toBe(true);
      }
    });
  });
});
