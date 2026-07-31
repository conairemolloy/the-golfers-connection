// Shared fixture builder for the request service test suite. Like
// tests/ledger, this never signs in as anyone — createRequest/
// withdrawRequest/expireRequests/listBook/myRequests are called
// directly against a transaction on the `postgres` role. Unlike
// tests/ledger, nothing here writes to ledger_entries, so nothing needs
// to survive: every test runs inside its own transaction, rolled back
// at the end via runAndRollback (tx.rollback()) — no idempotency
// bookkeeping, no permanent fixture rounds, no residue to clean up
// later. See tests/ledger/property.test.ts for why ROLLBACK is safe:
// it's transaction control, not UPDATE/DELETE, so the append-only
// trigger (irrelevant here anyway — nothing in this suite touches
// ledger_entries except setBalance, and that's inside the same rolled-
// back transaction too) never enters into it.
//
// The one thing that IS permanent, and has to be: the member pool.
// profiles.id is a FK to auth.users.id, and creating an auth user goes
// through Supabase's HTTP API, not our DB transaction — it cannot be
// rolled back with everything else. So a small pool of members is
// found-or-created once, the same way tests/ledger/harness.ts does it,
// and reset to a known baseline on every ensure — nothing in this
// suite's tests should depend on cross-run member state, since every
// club, membership, request and ledger entry they touch lives inside a
// transaction that vanishes at the end of each test.
//
// The pg client, closeDb, withTransaction, runAndRollback, supaAdmin
// and the ephemeral builders (createClub/createCourse/setMembership/
// setBalance/futureDate) all live in tests/support — see that module
// for the full reasoning behind each.

import type { Tx } from "@/lib/ledger";
import { assertTestEnv, ensureProfile } from "../support";
import * as support from "../support";

assertTestEnv("tests/requests");

export { closeDb, db, runAndRollback, withTransaction } from "../support";
export { futureDate, setMembership } from "../support";

const FIXED_EMAIL_DOMAIN = "requests-fixture.invalid";
const MARKER_PREFIX = "ZZ Requests Fixture — ";

export interface RequestFixtures {
  memberA: string;
  memberB: string;
  memberC: string;
  discretionMember: string;
}

let fixturesPromise: Promise<RequestFixtures> | undefined;

export function ensureRequestFixtures(): Promise<RequestFixtures> {
  if (!fixturesPromise) {
    fixturesPromise = buildRequestFixtures();
  }
  return fixturesPromise;
}

async function buildRequestFixtures(): Promise<RequestFixtures> {
  const opts = { domain: FIXED_EMAIL_DOMAIN, markerPrefix: MARKER_PREFIX, discretionMode: false };
  const [memberA, memberB, memberC, discretionMember] = await Promise.all([
    ensureProfile("member-a", opts),
    ensureProfile("member-b", opts),
    ensureProfile("member-c", opts),
    ensureProfile("discretion-member", opts),
  ]);
  return { memberA, memberB, memberC, discretionMember };
}

// --- ephemeral, transaction-scoped builders -------------------------------
// Thin wrappers over tests/support/builders.ts, binding this suite's own
// MARKER_PREFIX so fixture rows stay in their own namespace.

export function createClub(tx: Tx, opts: { tier: number }): Promise<string> {
  return support.createClub(tx, MARKER_PREFIX, opts);
}

export function createCourse(tx: Tx, clubId: string): Promise<string> {
  return support.createCourse(tx, MARKER_PREFIX, clubId);
}

export function setBalance(tx: Tx, userId: string, balance: number): Promise<void> {
  return support.setBalance(tx, MARKER_PREFIX, "requests-test-setup", userId, balance);
}
