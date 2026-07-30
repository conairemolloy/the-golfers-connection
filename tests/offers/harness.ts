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

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import * as schema from "@/db/schema";
import type { Tx } from "@/lib/ledger";
import { acceptOffer, makeOffer, type MakeOfferInput } from "@/lib/offers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  throw new Error(
    "tests/offers requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — " +
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
 * Runs `fn` inside a transaction, then forces a ROLLBACK. See
 * tests/requests/harness.ts's runAndRollback for the full reasoning —
 * identical here.
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

const FIXED_EMAIL_DOMAIN = "offers-fixture.invalid";
const MARKER_PREFIX = "ZZ Offers Fixture — ";

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
      password: "Offers-Test-Suite-Passw0rd-1!",
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed for ${email}: ${error?.message}`);
    }
    userId = data.user.id;
  }

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
  const [requesterA, requesterB, hostA, hostB, hostC] = await Promise.all([
    ensureMemberProfile("requester-a"),
    ensureMemberProfile("requester-b"),
    ensureMemberProfile("host-a"),
    ensureMemberProfile("host-b"),
    ensureMemberProfile("host-c"),
  ]);
  return { requesterA, requesterB, hostA, hostB, hostC };
}

// --- ephemeral, transaction-scoped builders -------------------------------
// Everything below writes through the caller's `tx`, not `db` — it only
// ever needs to exist for the lifetime of that one transaction.

let clubCounter = 0;

export async function createClub(tx: Tx, opts: { tier: number } = { tier: 2 }): Promise<string> {
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
 * Gives `userId` a specific ledger balance, exactly like
 * tests/requests/harness.ts's setBalance — needed here for the
 * decision-1 test: makeOffer must succeed even when the host's standing
 * is 'closed'.
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
    idempotencyKey: `offers-test-setup:${idempotencyCounter}`,
  });
}

export function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/** A local (no-offset) tee-time string on the given day, per teeAtLocal's convention. */
export function localTeeTime(daysFromNow: number, time = "09:00:00"): string {
  return `${futureDate(daysFromNow)}T${time}`;
}

/** Directly inserts an open request and its targets — bypasses createRequest's own tier/standing/validation checks, which are requests.ts's concern, not offers.ts's. */
export async function createOpenRequest(
  tx: Tx,
  userId: string,
  targetClubIds: string[],
  opts: { dateFrom?: string; dateTo?: string; partySize?: number } = {},
): Promise<string> {
  const dateFrom = opts.dateFrom ?? futureDate(10);
  const dateTo = opts.dateTo ?? futureDate(12);
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
  await setMembership(tx, opts.hostId, clubId, "club_confirmed");

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
