// Shared fixture builder for the thread service test suite. Same
// conventions as tests/offers/harness.ts: listThreads/readThread/
// sendMessage/markRead/muteThread/unmuteThread are called directly
// against a transaction on the `postgres` role, and every test runs
// inside its own transaction, rolled back at the end via runAndRollback.
//
// buildAcceptedThread goes through the real makeOffer/acceptOffer
// service functions (not hand-inserted rows) so these tests exercise
// the same thread-creation path production code takes — acceptOffer is
// the only place a thread is created (see CLAUDE.md's domain rule: no
// thread from a profile).
//
// The one thing that IS permanent: the member pool, for the same reason
// as tests/offers and tests/requests — profiles.id is a FK to
// auth.users.id, created through Supabase's HTTP API, outside any DB
// transaction this suite controls.

import type { Tx } from "@/lib/ledger";
import { acceptOffer, makeOffer, type MakeOfferInput } from "@/lib/offers";
import { assertTestEnv, ensureProfile, futureDate } from "../support";
import * as support from "../support";

assertTestEnv("tests/threads");

export { closeDb, db, runAndRollback, withTransaction } from "../support";
export { futureDate, setMembership } from "../support";

const FIXED_EMAIL_DOMAIN = "threads-fixture.invalid";
const MARKER_PREFIX = "ZZ Threads Fixture — ";

export interface ThreadFixtures {
  requesterA: string;
  requesterB: string;
  hostA: string;
  hostB: string;
  outsiderA: string;
}

let fixturesPromise: Promise<ThreadFixtures> | undefined;

export function ensureThreadFixtures(): Promise<ThreadFixtures> {
  if (!fixturesPromise) {
    fixturesPromise = buildThreadFixtures();
  }
  return fixturesPromise;
}

async function buildThreadFixtures(): Promise<ThreadFixtures> {
  const opts = { domain: FIXED_EMAIL_DOMAIN, markerPrefix: MARKER_PREFIX, discretionMode: false };
  const [requesterA, requesterB, hostA, hostB, outsiderA] = await Promise.all([
    ensureProfile("requester-a", opts),
    ensureProfile("requester-b", opts),
    ensureProfile("host-a", opts),
    ensureProfile("host-b", opts),
    ensureProfile("outsider-a", opts),
  ]);
  return { requesterA, requesterB, hostA, hostB, outsiderA };
}

// --- ephemeral, transaction-scoped builders -------------------------------
// Thin wrappers over tests/support/builders.ts, binding this suite's own
// MARKER_PREFIX so fixture rows stay in their own namespace.

export function createClub(tx: Tx, opts: { tier: number } = { tier: 2 }): Promise<string> {
  return support.createClub(tx, MARKER_PREFIX, opts);
}

export function createCourse(tx: Tx, clubId: string): Promise<string> {
  return support.createCourse(tx, MARKER_PREFIX, clubId);
}

/** A local (no-offset) tee-time string on the given day, per teeAtLocal's convention. */
export function localTeeTime(daysFromNow: number, time = "09:00:00"): string {
  return `${futureDate(daysFromNow)}T${time}`;
}

/** Directly inserts an open request and its targets — bypasses createRequest's own checks, not this suite's concern. */
export function createOpenRequest(
  tx: Tx,
  userId: string,
  targetClubIds: string[],
  opts: { dateFrom?: string; dateTo?: string; partySize?: number } = {},
): Promise<string> {
  return support.createOpenRequest(
    tx,
    userId,
    targetClubIds,
    { dateFrom: futureDate(10), dateTo: futureDate(12) },
    opts,
  );
}

export interface AcceptedThreadFixture {
  threadId: string;
  roundId: string;
  requesterId: string;
  hostId: string;
  clubId: string;
  courseId: string;
}

/**
 * Builds a real round thread end-to-end through makeOffer/acceptOffer —
 * the only production path that creates a thread.
 */
export async function buildAcceptedThread(
  tx: Tx,
  opts: { requesterId: string; hostId: string; teeAtLocal?: string },
): Promise<AcceptedThreadFixture> {
  const clubId = await createClub(tx);
  const courseId = await createCourse(tx, clubId);
  await support.setMembership(tx, opts.hostId, clubId, "club_confirmed");

  const requestId = await createOpenRequest(tx, opts.requesterId, [clubId]);

  const offerInput: MakeOfferInput = {
    clubId,
    courseId,
    teeAtLocal: opts.teeAtLocal ?? localTeeTime(11),
    teeTimezone: "Europe/Dublin",
  };
  const { offerId } = await makeOffer(tx, opts.hostId, requestId, offerInput);
  const { roundId, threadId } = await acceptOffer(tx, opts.requesterId, offerId);

  return { threadId, roundId, requesterId: opts.requesterId, hostId: opts.hostId, clubId, courseId };
}
