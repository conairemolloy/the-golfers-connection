// Shared fixture builder for the availability service test suite. Same
// conventions as tests/offers/harness.ts and tests/requests/harness.ts:
// declareAvailability/updateAvailability/deactivateAvailability/
// matchRequestToAvailability/matchAvailabilityToRequests/declineToHost
// are called directly against a transaction on the `postgres` role, and
// every test runs inside its own transaction, rolled back at the end via
// runAndRollback. Nothing here writes to ledger_entries, so — like
// tests/requests — there's no idempotency bookkeeping and no permanent
// fixture rows beyond the member pool.
//
// The pg client, closeDb, withTransaction, runAndRollback, supaAdmin
// and the ephemeral builders (createClub/createCourse/setMembership/
// futureDate/isoWeekdayOf/createOpenRequest) all live in tests/support —
// see that module for the full reasoning behind each.

import type { Tx } from "@/lib/ledger";
import { assertTestEnv, ensureProfile, futureDate } from "../support";
import * as support from "../support";

assertTestEnv("tests/availability");

export { closeDb, db, runAndRollback, withTransaction } from "../support";
export { futureDate, isoWeekdayOf, setMembership } from "../support";

const FIXED_EMAIL_DOMAIN = "availability-fixture.invalid";
const MARKER_PREFIX = "ZZ Availability Fixture — ";

export interface AvailabilityFixtures {
  hostA: string;
  hostB: string;
  requesterA: string;
  requesterB: string;
  applicant: string;
}

let fixturesPromise: Promise<AvailabilityFixtures> | undefined;

export function ensureAvailabilityFixtures(): Promise<AvailabilityFixtures> {
  if (!fixturesPromise) {
    fixturesPromise = buildAvailabilityFixtures();
  }
  return fixturesPromise;
}

// Deliberately left as 'applicant' — the fixture for "suggested member
// must be a real member" needs a profile that exists but is not one.
function ensureApplicantProfile(label: string): Promise<string> {
  return ensureProfile(label, {
    domain: FIXED_EMAIL_DOMAIN,
    markerPrefix: MARKER_PREFIX,
    status: "applicant",
    discretionMode: false,
  });
}

async function buildAvailabilityFixtures(): Promise<AvailabilityFixtures> {
  const memberOpts = { domain: FIXED_EMAIL_DOMAIN, markerPrefix: MARKER_PREFIX, discretionMode: false };
  const [hostA, hostB, requesterA, requesterB, applicant] = await Promise.all([
    ensureProfile("host-a", memberOpts),
    ensureProfile("host-b", memberOpts),
    ensureProfile("requester-a", memberOpts),
    ensureProfile("requester-b", memberOpts),
    ensureApplicantProfile("applicant-a"),
  ]);
  return { hostA, hostB, requesterA, requesterB, applicant };
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

/** Directly inserts an open request and its targets — bypasses createRequest's own tier/standing/validation checks. */
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
    { dateFrom: futureDate(30), dateTo: futureDate(36) },
    opts,
  );
}
