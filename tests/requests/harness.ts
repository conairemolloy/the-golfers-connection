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

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import * as schema from "@/db/schema";
import type { Tx } from "@/lib/ledger";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  throw new Error(
    "tests/requests requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — " +
      "run via `pnpm test`, which loads .env.local.",
  );
}

let pgClient: postgres.Sql | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDb() {
  if (!dbInstance) {
    pgClient = postgres(DATABASE_URL);
    dbInstance = drizzle(pgClient, { schema });
  }
  return dbInstance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export async function closeDb(): Promise<void> {
  if (pgClient) {
    await pgClient.end({ timeout: 5 });
    pgClient = undefined;
    dbInstance = undefined;
  }
}

// See tests/ledger/harness.ts's withTransaction for why this goes
// through the real drizzle instance directly, and why the cast is safe.
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const database = getDb() as unknown as { transaction: (fn: (tx: Tx) => Promise<T>) => Promise<T> };
  return database.transaction(fn);
}

/**
 * Runs `fn` inside a transaction, then forces a ROLLBACK — the standard
 * shape for a test that needs to assert on DB state it wrote, without
 * any of it surviving. `fn` does its own assertions using the `tx` it's
 * given; this just guarantees cleanup. Tests that expect `fn` itself to
 * throw (a RequestError) don't need this — an uncaught throw inside the
 * transaction callback rolls back on its own, and the rejection the
 * test should assert on is that error, not TransactionRollbackError.
 */
export async function runAndRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const outcome = withTransaction(async (tx) => {
    await fn(tx);
    tx.rollback();
  });
  const { TransactionRollbackError } = await import("drizzle-orm");
  await expect(outcome).rejects.toBeInstanceOf(TransactionRollbackError);
}

function supaAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const FIXED_EMAIL_DOMAIN = "requests-fixture.invalid";
const MARKER_PREFIX = "ZZ Requests Fixture — ";

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from auth.users where email = ${email} limit 1`,
  );
  return rows[0]?.id ?? null;
}

async function ensureMemberProfile(label: string): Promise<string> {
  const email = `${label}@${FIXED_EMAIL_DOMAIN}`;
  const admin = supaAdmin();
  let userId = await findAuthUserIdByEmail(email);
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "Requests-Test-Suite-Passw0rd-1!",
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed for ${email}: ${error?.message}`);
    }
    userId = data.user.id;
  }

  // Reset to a known baseline every run: status/name/discretion are read
  // by the code under test, so a value left over from a differently
  // -themed earlier run must not leak into this suite's assumptions.
  await db
    .update(schema.profiles)
    .set({
      status: "member",
      displayName: `${MARKER_PREFIX}${label}`,
      initials: label.slice(0, 2).toUpperCase(),
      discretionMode: false,
    })
    .where(eq(schema.profiles.id, userId));

  return userId;
}

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
  const [memberA, memberB, memberC, discretionMember] = await Promise.all([
    ensureMemberProfile("member-a"),
    ensureMemberProfile("member-b"),
    ensureMemberProfile("member-c"),
    ensureMemberProfile("discretion-member"),
  ]);
  return { memberA, memberB, memberC, discretionMember };
}

// --- ephemeral, transaction-scoped builders -------------------------------
// Everything below writes through the caller's `tx`, not `db` — it only
// ever needs to exist for the lifetime of that one transaction.

let clubCounter = 0;

export async function createClub(tx: Tx, opts: { tier: number }): Promise<string> {
  clubCounter += 1;
  const [club] = await tx
    .insert(schema.clubs)
    .values({
      name: `${MARKER_PREFIX}Club tier ${opts.tier} #${clubCounter}`,
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

export async function createCourse(tx: Tx, clubId: string): Promise<string> {
  const [course] = await tx
    .insert(schema.clubCourses)
    .values({ clubId, name: `${MARKER_PREFIX}Course`, holes: 18, par: 72 })
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
 * rollback. Only setBalance's own round-building touches ledger_entries
 * or rounds; the rest of this suite never does.
 */
export async function setBalance(tx: Tx, userId: string, balance: number): Promise<void> {
  if (balance === 0) return;

  const clubId = await createClub(tx, { tier: 1 });
  const courseId = await createCourse(tx, clubId);
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
    idempotencyKey: `requests-test-setup:${idempotencyCounter}`,
  });
}

export function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
