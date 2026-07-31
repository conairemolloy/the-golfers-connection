// Shared fixture builder for the offer service test suite. Same
// conventions as tests/requests/harness.ts: makeOffer/withdrawOffer/
// rejectOffer/acceptOffer/fillRequest/confirmRound/cancelRound are
// called directly against a transaction on the `postgres` role, and
// every test runs inside its own transaction, rolled back at the end
// via runAndRollback — including the ones that settle or reverse a
// round, since ROLLBACK is transaction control, not UPDATE/DELETE, so
// the ledger's append-only trigger never enters into it (see
// tests/ledger/property.test.ts for the same reasoning).
//
// The one thing that IS permanent: the member pool, for the same reason
// as tests/requests and tests/ledger — profiles.id is a FK to
// auth.users.id, created through Supabase's HTTP API, outside any DB
// transaction this suite controls.
//
// The pg client, closeDb, withTransaction, runAndRollback, supaAdmin
// and the ephemeral builders (createClub/createCourse/setMembership/
// setBalance/futureDate/createOpenRequest) all live in tests/support —
// see that module for the full reasoning behind each.

import type { Tx } from "@/lib/ledger";
import { acceptOffer, makeOffer, type MakeOfferInput } from "@/lib/offers";
import { assertTestEnv, ensureProfile, futureDate } from "../support";
import * as support from "../support";

assertTestEnv("tests/offers");

export { closeDb, db, runAndRollback, withTransaction } from "../support";
export { futureDate, setMembership } from "../support";

const FIXED_EMAIL_DOMAIN = "offers-fixture.invalid";
const MARKER_PREFIX = "ZZ Offers Fixture — ";

export interface OfferFixtures {
  requesterA: string;
  requesterB: string;
  hostA: string;
  hostB: string;
  hostC: string;
}

let fixturesPromise: Promise<OfferFixtures> | undefined;

export function ensureOfferFixtures(): Promise<OfferFixtures> {
  if (!fixturesPromise) {
    fixturesPromise = buildOfferFixtures();
  }
  return fixturesPromise;
}

async function buildOfferFixtures(): Promise<OfferFixtures> {
  const opts = { domain: FIXED_EMAIL_DOMAIN, markerPrefix: MARKER_PREFIX, discretionMode: false };
  const [requesterA, requesterB, hostA, hostB, hostC] = await Promise.all([
    ensureProfile("requester-a", opts),
    ensureProfile("requester-b", opts),
    ensureProfile("host-a", opts),
    ensureProfile("host-b", opts),
    ensureProfile("host-c", opts),
  ]);
  return { requesterA, requesterB, hostA, hostB, hostC };
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

/**
 * Gives `userId` a specific ledger balance, exactly like
 * tests/requests/harness.ts's setBalance — needed here for the
 * decision-1 test: makeOffer must succeed even when the host's standing
 * is 'closed'.
 */
export function setBalance(tx: Tx, userId: string, balance: number): Promise<void> {
  return support.setBalance(tx, MARKER_PREFIX, "offers-test-setup", userId, balance);
}

/** A local (no-offset) tee-time string on the given day, per teeAtLocal's convention. */
export function localTeeTime(daysFromNow: number, time = "09:00:00"): string {
  return `${futureDate(daysFromNow)}T${time}`;
}

/** Directly inserts an open request and its targets — bypasses createRequest's own tier/standing/validation checks, which are requests.ts's concern, not offers.ts's. */
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

export interface AcceptedRoundFixture {
  requestId: string;
  offerId: string;
  roundId: string;
  threadId: string;
  requesterId: string;
  hostId: string;
  clubId: string;
  courseId: string;
}

/**
 * End-to-end fixture builder for tests further down the lifecycle
 * (confirmRound, cancelRound, expireRequests-with-an-accepted-offer):
 * a club-confirmed host, an open request targeting his club, a live
 * offer, and its acceptance — built through the real makeOffer/
 * acceptOffer service functions rather than hand-inserted rows, so
 * these tests exercise the same path production code takes.
 */
export async function buildAcceptedRound(
  tx: Tx,
  opts: {
    requesterId: string;
    hostId: string;
    teeAtLocal?: string;
    plusOnes?: string[];
    requestDateFrom?: string;
    requestDateTo?: string;
  },
): Promise<AcceptedRoundFixture> {
  const clubId = await createClub(tx);
  const courseId = await createCourse(tx, clubId);
  await support.setMembership(tx, opts.hostId, clubId, "club_confirmed");

  const requestId = await createOpenRequest(tx, opts.requesterId, [clubId], {
    dateFrom: opts.requestDateFrom,
    dateTo: opts.requestDateTo,
  });

  const offerInput: MakeOfferInput = {
    clubId,
    courseId,
    teeAtLocal: opts.teeAtLocal ?? localTeeTime(11),
    teeTimezone: "Europe/Dublin",
  };
  const { offerId } = await makeOffer(tx, opts.hostId, requestId, offerInput);
  const { roundId, threadId } = await acceptOffer(tx, opts.requesterId, offerId, { plusOnes: opts.plusOnes });

  return { requestId, offerId, roundId, threadId, requesterId: opts.requesterId, hostId: opts.hostId, clubId, courseId };
}
