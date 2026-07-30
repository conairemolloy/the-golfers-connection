// Shared fixture builder for the availability service test suite. Same
// conventions as tests/offers/harness.ts and tests/requests/harness.ts:
// declareAvailability/updateAvailability/deactivateAvailability/
// matchRequestToAvailability/matchAvailabilityToRequests/declineToHost
// are called directly against a transaction on the `postgres` role, and
// every test runs inside its own transaction, rolled back at the end via
// runAndRollback. Nothing here writes to ledger_entries, so — like
// tests/requests — there's no idempotency bookkeeping and no permanent
// fixture rows beyond the member pool.

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
    "tests/availability requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — " +
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

const FIXED_EMAIL_DOMAIN = "availability-fixture.invalid";
const MARKER_PREFIX = "ZZ Availability Fixture — ";

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
      password: "Availability-Test-Suite-Passw0rd-1!",
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

async function ensureApplicantProfile(label: string): Promise<string> {
  const email = `${label}@${FIXED_EMAIL_DOMAIN}`;
  const admin = supaAdmin();
  let userId = await findAuthUserIdByEmail(email);
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "Availability-Test-Suite-Passw0rd-1!",
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed for ${email}: ${error?.message}`);
    }
    userId = data.user.id;
  }

  // Deliberately left as 'applicant' — the fixture for "suggested member
  // must be a real member" needs a profile that exists but is not one.
  await db
    .update(schema.profiles)
    .set({
      status: "applicant",
      displayName: `${MARKER_PREFIX}${label}`,
      initials: label.slice(0, 2).toUpperCase(),
      discretionMode: false,
    })
    .where(eq(schema.profiles.id, userId));

  return userId;
}

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

async function buildAvailabilityFixtures(): Promise<AvailabilityFixtures> {
  const [hostA, hostB, requesterA, requesterB, applicant] = await Promise.all([
    ensureMemberProfile("host-a"),
    ensureMemberProfile("host-b"),
    ensureMemberProfile("requester-a"),
    ensureMemberProfile("requester-b"),
    ensureApplicantProfile("applicant-a"),
  ]);
  return { hostA, hostB, requesterA, requesterB, applicant };
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

/** Directly inserts an open request and its targets — bypasses createRequest's own tier/standing/validation checks. */
export async function createOpenRequest(
  tx: Tx,
  userId: string,
  targetClubIds: string[],
  opts: { dateFrom?: string; dateTo?: string; partySize?: number } = {},
): Promise<string> {
  const dateFrom = opts.dateFrom ?? futureDate(30);
  const dateTo = opts.dateTo ?? futureDate(36);
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
