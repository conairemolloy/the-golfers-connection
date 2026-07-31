// Shared ephemeral, transaction-scoped fixture builders for the three
// suites whose tests each run inside their own rolled-back transaction:
// tests/requests, tests/offers, tests/availability. tests/ledger and
// tests/rls build clubs/courses/members their own way (permanent,
// marker-idempotent fixtures) and don't use this module.
//
// Everything below writes through the caller's `tx`, not the shared
// `db` — it only ever needs to exist for the lifetime of that one
// transaction. Each function takes an explicit `markerPrefix` rather
// than reading a module constant, so each suite keeps its own fixture
// namespace while sharing the implementation.

import * as schema from "@/db/schema";
import type { Tx } from "@/lib/ledger";

let clubCounter = 0;

export async function createClub(
  tx: Tx,
  markerPrefix: string,
  opts: { tier: number } = { tier: 2 },
): Promise<string> {
  clubCounter += 1;
  const [club] = await tx
    .insert(schema.clubs)
    .values({
      name: `${markerPrefix}Club tier ${opts.tier} #${clubCounter}`,
      region: "Fixture Region",
      country: "IE",
      tier: opts.tier,
      accessDifficulty: 1,
      lat: 53.35,
      lng: -6.26,
      timezone: "Europe/Dublin",
    })
    .returning();
  return club.id;
}

export async function createCourse(tx: Tx, markerPrefix: string, clubId: string): Promise<string> {
  const [course] = await tx
    .insert(schema.clubCourses)
    .values({ clubId, name: `${markerPrefix}Course`, holes: 18, par: 72 })
    .returning();
  return course.id;
}

export async function setMembership(
  tx: Tx,
  userId: string,
  clubId: string,
  verificationState: "declared" | "documented" | "club_confirmed",
): Promise<void> {
  await tx.insert(schema.memberships).values({
    userId,
    clubId,
    verificationState,
    confirmedAt: verificationState === "club_confirmed" ? new Date() : null,
  });
}

let idempotencyCounter = 0;

/**
 * Gives `userId` a specific ledger balance by inserting one throwaway
 * ledger_entries row (attached to a throwaway round created for this
 * purpose) — inside the caller's transaction, so it never survives past
 * rollback. `keyPrefix` namespaces the idempotency key per suite so two
 * suites' throwaway entries can never collide.
 */
export async function setBalance(
  tx: Tx,
  markerPrefix: string,
  keyPrefix: string,
  userId: string,
  balance: number,
): Promise<void> {
  if (balance === 0) return;

  const clubId = await createClub(tx, markerPrefix, { tier: 1 });
  const courseId = await createCourse(tx, markerPrefix, clubId);
  const [request] = await tx
    .insert(schema.requests)
    .values({
      userId,
      region: "Fixture Region",
      dateFrom: "2025-06-01",
      dateTo: "2025-06-10",
      partySize: 1,
      state: "filled",
      expiresAt: new Date("2025-07-01T00:00:00Z"),
    })
    .returning();
  const [offer] = await tx
    .insert(schema.offers)
    .values({
      requestId: request.id,
      hostId: userId,
      clubId,
      courseId,
      teeAtLocal: new Date("2025-06-05T09:00:00"),
      teeTimezone: "Europe/Dublin",
      state: "confirmed",
    })
    .returning();
  const [round] = await tx
    .insert(schema.rounds)
    .values({ offerId: offer.id, courseId, playedOn: "2025-06-05", hostId: userId })
    .returning();

  idempotencyCounter += 1;
  await tx.insert(schema.ledgerEntries).values({
    userId,
    roundId: round.id,
    direction: balance > 0 ? "credit" : "debit",
    amount: Math.abs(balance),
    reason: "test setup — setBalance",
    idempotencyKey: `${keyPrefix}:${idempotencyCounter}`,
  });
}

export function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * ISO weekday (0 = Monday .. 6 = Sunday) for a YYYY-MM-DD date. An
 * independent formula from availability.ts's own isoWeekday — verified
 * against Python's date.isoweekday() - 1 — so tests that build a weekday
 * window fixture aren't just checking the implementation against itself.
 */
export function isoWeekdayOf(dateStr: string): number {
  const jsDay = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return (jsDay + 6) % 7;
}

/**
 * Directly inserts an open request and its targets — bypasses
 * createRequest's own tier/standing/validation checks, which are
 * requests.ts's concern, not the caller's. `defaults` supplies the
 * suite's own date-window fallback (offers and availability use
 * different windows) when the caller doesn't pass dateFrom/dateTo.
 */
export async function createOpenRequest(
  tx: Tx,
  userId: string,
  targetClubIds: string[],
  defaults: { dateFrom: string; dateTo: string },
  opts: { dateFrom?: string; dateTo?: string; partySize?: number } = {},
): Promise<string> {
  const dateFrom = opts.dateFrom ?? defaults.dateFrom;
  const dateTo = opts.dateTo ?? defaults.dateTo;
  const [request] = await tx
    .insert(schema.requests)
    .values({
      userId,
      region: "Fixture Region",
      dateFrom,
      dateTo,
      partySize: opts.partySize ?? 2,
      state: "open",
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    })
    .returning();
  await tx.insert(schema.requestTargets).values(targetClubIds.map((clubId) => ({ requestId: request.id, clubId })));
  return request.id;
}
