// Shared fixture builder and client factory for the RLS hostile-member
// suite. See setup.global.ts for how this is wired into vitest, and the
// per-group *.test.ts files for how fixtures are consumed.
//
// THREAT MODEL (restated from 0007_rls_policies.sql): these tests must
// connect through supabase-js with a real authenticated session, not the
// Drizzle/postgres connection — that connection uses the `postgres` role,
// which bypasses RLS entirely and would prove nothing about the policies
// under test. The Drizzle connection here is used only for fixture setup
// and teardown, and for schema introspection (group 1 and group 10, which
// need to see pg_catalog/information_schema — tables PostgREST does not
// expose to any client, including service_role).
//
// PERMANENT FIXTURES
// ledger_entries is append-only (trigger-enforced; see
// 0003_ledger_immutability.sql) and rounds/offers/requests have no
// ON DELETE cascade into it. That means any round with a ledger entry
// can never be torn down — nor can the offer, request, or profiles that
// round transitively references. Rather than accumulate a fresh orphaned
// club/member/round/ledger-entry chain on every run, one member (MEMBER_B)
// one admin (ADMIN), their two clubs, and the round/ledger pair that
// exercises ledger isolation are find-or-created against a stable key and
// left in place forever — this is the one deliberate exception to "every
// fixture gets a unique run prefix". Alongside them, B's permanent active
// host_availability row and a permanent guest-name-only (plus-one)
// round_participants row on the fixed round are find-or-created the same
// way. They are named so they can never be mistaken for real data or
// counted as real clubs/members:
//   - emails under @rls-fixture.invalid (RFC 2606 reserved, unroutable)
//   - club names prefixed "ZZ RLS Fixture — "
//   - the ledger entries' reason field: see FIXED_LEDGER_REASON below
//   - host_availability.note and round_participants.guest_name: see
//     FIXED_AVAILABILITY_NOTE and FIXED_PLUS_ONE_GUEST_NAME below
// Any seed script or club-count/member-count query must exclude rows
// matching the "ZZ RLS Fixture — " club-name prefix and the
// rls-fixture.invalid email domain.
//
// Everything else (MEMBER_A, APPLICANT, UNCONFIRMED, their clubs,
// requests, threads, messages, feedback) is created fresh under a
// per-run prefix and fully deleted in teardown.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  throw new Error(
    "tests/rls requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
      "SUPABASE_SERVICE_ROLE_KEY — run via `pnpm test`, which loads .env.local.",
  );
}

// A dedicated connection, not the app's src/db/index.ts singleton: that
// one is designed to stay open for the lifetime of a server process. Each
// vitest file gets a fresh module registry (isolate: true, the default),
// so every file that touches `db` would otherwise open a connection with
// nothing to close it, and vitest hangs on exit waiting for the socket.
// Created lazily so files that never touch `db` (most of them — they only
// need supabase-js clients) don't open a connection at all.
let pgClient: postgres.Sql | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDb() {
  if (!dbInstance) {
    pgClient = postgres(DATABASE_URL);
    dbInstance = drizzle(pgClient, { schema });
  }
  return dbInstance;
}

// Proxy so every existing `db.select()/.insert()/...` call site below
// works unchanged, while the underlying connection is still lazy.
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

export const PASSWORD = "Rls-Test-Suite-Passw0rd-1!";

// Asserts an operation was denied by a policy or grant — NOT that it
// merely produced *an* error. round_participants and thread_members each
// have a SELECT policy that queries their own table in an EXISTS
// subquery, which Postgres's RLS evaluator cannot handle (it recurses
// back into the same policy): Postgres error 42P17, "infinite recursion
// detected in policy". Anything that checks round_participants or
// thread_members membership as part of a WITH CHECK — messages INSERT,
// feedback INSERT — crashes with 42P17 instead of being cleanly denied.
// A bare `expect(error).not.toBeNull()` cannot tell that crash apart
// from a real denial, so it would report the write as correctly blocked
// when it actually never got a fair evaluation. Use this helper for
// every "cannot do X" assertion instead.
export function expectDenied(error: { code?: string | null; message?: string | null } | null) {
  if (error?.code === "42P17") {
    throw new Error(
      `operation was not cleanly denied — it crashed on RLS recursion instead: ${error.message}`,
    );
  }
  if (!error) {
    throw new Error("expected the operation to be denied, but it succeeded");
  }
}

const FIXED_CLUB_PREFIX = "ZZ RLS Fixture — ";
const FIXED_EMAIL_DOMAIN = "rls-fixture.invalid";
const FIXED_LEDGER_REASON = "RLS FIXTURE — permanent, see tests/rls/harness.ts";
const FIXED_OFFER_MARKER = "ZZ RLS Fixture — permanent round, see tests/rls/harness.ts";
const FIXED_AVAILABILITY_NOTE = "ZZ RLS Fixture — permanent availability, see tests/rls/harness.ts";
const FIXED_PLUS_ONE_GUEST_NAME = "ZZ RLS Fixture — permanent plus-one, see tests/rls/harness.ts";

// --- supabase clients --------------------------------------------------

export function supaAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function supaAnon(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function signInAs(email: string): Promise<SupabaseClient> {
  const client = supaAnon();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    throw new Error(`sign-in failed for ${email}: ${error.message}`);
  }
  return client;
}

// --- fixture shape -------------------------------------------------------

export interface FixedFixtures {
  club1Id: string; // tier 1, MEMBER_B's home
  club3Id: string; // tier 3, ADMIN's home
  course3Id: string;
  memberBId: string;
  memberBEmail: string;
  adminId: string;
  adminEmail: string;
  requestForRoundId: string;
  offerId: string;
  roundId: string;
  availabilityBId: string; // B's permanent, active host_availability row at club1
  plusOneParticipantId: string; // permanent guest-name-only round_participants row on roundId
}

export interface EphemeralFixtures {
  runPrefix: string;
  club2Id: string; // tier 2, MEMBER_A's home
  club4Id: string; // tier 4, UNCONFIRMED's club
  memberAId: string;
  memberAEmail: string;
  applicantId: string;
  applicantEmail: string;
  unconfirmedId: string;
  unconfirmedEmail: string;
  requestAId: string; // open, owned by A
  requestBId: string; // open, owned by (fixed) B
  requestUnconfirmedId: string; // open, owned by UNCONFIRMED
  threadOwnedId: string; // A is a member
  threadOtherId: string; // A is not a member (fixed B is)
  messageOwnedId: string;
  messageOtherId: string;
  feedbackUnreleasedAboutAId: string;
  feedbackReleasedAboutAId: string;
  feedbackByAAboutBId: string;
}

export interface Fixtures {
  fixed: FixedFixtures;
  ephemeral: EphemeralFixtures;
}

// --- small find-or-create helpers ---------------------------------------

async function findOrCreateClub(name: string, tier: number) {
  const existing = await db.select().from(schema.clubs).where(eq(schema.clubs.name, name));
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(schema.clubs)
    .values({
      name,
      region: "Fixture Region",
      country: "IE",
      tier,
      accessDifficulty: 1,
      lat: 53.35,
      lng: -6.26,
      timezone: "Europe/Dublin",
    })
    .returning();
  return row;
}

async function findOrCreateCourse(clubId: string, name: string) {
  const existing = await db
    .select()
    .from(schema.clubCourses)
    .where(eq(schema.clubCourses.clubId, clubId));
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(schema.clubCourses)
    .values({ clubId, name, holes: 18, par: 72 })
    .returning();
  return row;
}

async function findOrCreateAvailability(userId: string, clubId: string, note: string) {
  const existing = await db
    .select()
    .from(schema.hostAvailability)
    .where(and(eq(schema.hostAvailability.userId, userId), eq(schema.hostAvailability.note, note)));
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(schema.hostAvailability)
    .values({ userId, clubId, weekday: 6, capacity: 1, active: true, note })
    .returning();
  return row;
}

async function findOrCreatePlusOne(roundId: string, guestName: string) {
  const existing = await db
    .select()
    .from(schema.roundParticipants)
    .where(
      and(
        eq(schema.roundParticipants.roundId, roundId),
        eq(schema.roundParticipants.guestName, guestName),
      ),
    );
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(schema.roundParticipants)
    .values({ roundId, userId: null, guestName, isMember: false, role: "guest" })
    .returning();
  return row;
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from auth.users where email = ${email} limit 1`,
  );
  return rows[0]?.id ?? null;
}

async function ensureAuthUser(admin: SupabaseClient, email: string): Promise<string> {
  const existingId = await findAuthUserIdByEmail(email);
  if (existingId) return existingId;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser failed for ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function setMemberProfile(
  userId: string,
  opts: { isAdmin: boolean; displayName: string; initials: string },
) {
  // status, displayName and initials must land in the same UPDATE:
  // profiles_member_needs_name_check (0006) is checked at statement end,
  // not deferred, so setting status='member' before the name columns are
  // populated would fail even transiently within one migration/session.
  await db
    .update(schema.profiles)
    .set({
      status: "member",
      isAdmin: opts.isAdmin,
      displayName: opts.displayName,
      initials: opts.initials,
    })
    .where(eq(schema.profiles.id, userId));
}

async function ensureMembership(
  userId: string,
  clubId: string,
  verificationState: "declared" | "club_confirmed",
) {
  const existing = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.clubId, clubId)));
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(schema.memberships)
    .values({
      userId,
      clubId,
      verificationState,
      confirmedAt: verificationState === "club_confirmed" ? new Date() : null,
    })
    .returning();
  return row;
}

// --- fixed (permanent) fixtures -----------------------------------------

async function buildFixedFixtures(admin: SupabaseClient): Promise<FixedFixtures> {
  const club1 = await findOrCreateClub(`${FIXED_CLUB_PREFIX}Tier 1 Club`, 1);
  const club3 = await findOrCreateClub(`${FIXED_CLUB_PREFIX}Tier 3 Club`, 3);
  const course3 = await findOrCreateCourse(club3.id, `${FIXED_CLUB_PREFIX}Tier 3 Course`);

  const memberBEmail = `member-b@${FIXED_EMAIL_DOMAIN}`;
  const adminEmail = `admin@${FIXED_EMAIL_DOMAIN}`;

  const memberBId = await ensureAuthUser(admin, memberBEmail);
  const adminId = await ensureAuthUser(admin, adminEmail);

  await setMemberProfile(memberBId, { isAdmin: false, displayName: "RLS Fixture B", initials: "RB" });
  await setMemberProfile(adminId, { isAdmin: true, displayName: "RLS Fixture Admin", initials: "RA" });

  await ensureMembership(memberBId, club1.id, "club_confirmed");
  await ensureMembership(adminId, club3.id, "club_confirmed");

  // Find the permanent round by its marker offer, or create the whole
  // chain (request -> offer -> round -> participants -> ledger) once.
  const existingOffer = await db
    .select()
    .from(schema.offers)
    .where(
      and(
        eq(schema.offers.hostId, adminId),
        eq(schema.offers.clubId, club3.id),
        eq(schema.offers.message, FIXED_OFFER_MARKER),
      ),
    );

  let requestForRoundId: string;
  let offerId: string;
  let roundId: string;

  if (existingOffer.length > 0) {
    offerId = existingOffer[0].id;
    requestForRoundId = existingOffer[0].requestId;
    const [existingRound] = await db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.offerId, offerId));
    roundId = existingRound.id;
  } else {
    const [request] = await db
      .insert(schema.requests)
      .values({
        userId: memberBId,
        region: "Fixture Region",
        dateFrom: "2025-01-10",
        dateTo: "2025-01-20",
        partySize: 2,
        state: "filled",
        expiresAt: new Date("2025-02-01T00:00:00Z"),
      })
      .returning();
    requestForRoundId = request.id;

    const [offer] = await db
      .insert(schema.offers)
      .values({
        requestId: requestForRoundId,
        hostId: adminId,
        clubId: club3.id,
        courseId: course3.id,
        teeAtLocal: new Date("2025-01-15T09:00:00"),
        teeTimezone: "Europe/Dublin",
        state: "confirmed",
        message: FIXED_OFFER_MARKER,
      })
      .returning();
    offerId = offer.id;

    const [round] = await db
      .insert(schema.rounds)
      .values({
        offerId,
        courseId: course3.id,
        playedOn: "2025-01-15",
        hostId: adminId,
        hostConfirmedAt: new Date("2025-01-15T14:00:00Z"),
        guestConfirmedAt: new Date("2025-01-15T14:05:00Z"),
        settledAt: new Date("2025-01-15T14:05:00Z"),
      })
      .returning();
    roundId = round.id;

    await db
      .insert(schema.roundParticipants)
      .values([
        { roundId, userId: adminId, role: "host" },
        { roundId, userId: memberBId, role: "guest" },
      ])
      .onConflictDoNothing();
  }

  // Ledger entries: fixed idempotency keys make this insert naturally
  // idempotent across reruns without a separate existence check.
  await db
    .insert(schema.ledgerEntries)
    .values([
      {
        userId: memberBId,
        roundId,
        direction: "credit",
        amount: 5000,
        reason: FIXED_LEDGER_REASON,
        idempotencyKey: "rls-fixture-ledger-credit-member-b",
      },
      {
        userId: memberBId,
        roundId,
        direction: "debit",
        amount: 2000,
        reason: FIXED_LEDGER_REASON,
        idempotencyKey: "rls-fixture-ledger-debit-member-b",
      },
    ])
    .onConflictDoNothing();

  const availabilityB = await findOrCreateAvailability(memberBId, club1.id, FIXED_AVAILABILITY_NOTE);
  const plusOne = await findOrCreatePlusOne(roundId, FIXED_PLUS_ONE_GUEST_NAME);

  return {
    club1Id: club1.id,
    club3Id: club3.id,
    course3Id: course3.id,
    memberBId,
    memberBEmail,
    adminId,
    adminEmail,
    requestForRoundId,
    offerId,
    roundId,
    availabilityBId: availabilityB.id,
    plusOneParticipantId: plusOne.id,
  };
}

// --- ephemeral (per-run) fixtures ----------------------------------------

async function buildEphemeralFixtures(
  admin: SupabaseClient,
  fixed: FixedFixtures,
): Promise<EphemeralFixtures> {
  const runPrefix = `rls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-`;

  const club2 = await findOrCreateClub(`${runPrefix}Tier 2 Club`, 2);
  const club4 = await findOrCreateClub(`${runPrefix}Tier 4 Club`, 4);
  await findOrCreateCourse(club2.id, `${runPrefix}Tier 2 Course`);
  await findOrCreateCourse(club4.id, `${runPrefix}Tier 4 Course`);

  const memberAEmail = `${runPrefix}member-a@example.com`;
  const applicantEmail = `${runPrefix}applicant@example.com`;
  const unconfirmedEmail = `${runPrefix}unconfirmed@example.com`;

  const memberAId = await ensureAuthUser(admin, memberAEmail);
  const applicantId = await ensureAuthUser(admin, applicantEmail);
  const unconfirmedId = await ensureAuthUser(admin, unconfirmedEmail);

  await setMemberProfile(memberAId, {
    isAdmin: false,
    displayName: "RLS Fixture A",
    initials: "RA2",
  });
  // APPLICANT stays status='applicant' — left as the auth trigger created it.
  await setMemberProfile(unconfirmedId, {
    isAdmin: false,
    displayName: "RLS Fixture Unconfirmed",
    initials: "RU",
  });

  await ensureMembership(memberAId, club2.id, "club_confirmed");
  await ensureMembership(unconfirmedId, club4.id, "declared");

  const [requestA] = await db
    .insert(schema.requests)
    .values({
      userId: memberAId,
      region: "Fixture Region",
      dateFrom: "2025-03-01",
      dateTo: "2025-03-10",
      partySize: 1,
      state: "open",
      expiresAt: new Date("2025-04-01T00:00:00Z"),
    })
    .returning();

  const [requestB] = await db
    .insert(schema.requests)
    .values({
      userId: fixed.memberBId,
      region: "Fixture Region",
      dateFrom: "2025-03-01",
      dateTo: "2025-03-10",
      partySize: 1,
      state: "open",
      expiresAt: new Date("2025-04-01T00:00:00Z"),
    })
    .returning();

  const [requestUnconfirmed] = await db
    .insert(schema.requests)
    .values({
      userId: unconfirmedId,
      region: "Fixture Region",
      dateFrom: "2025-03-01",
      dateTo: "2025-03-10",
      partySize: 1,
      state: "open",
      expiresAt: new Date("2025-04-01T00:00:00Z"),
    })
    .returning();

  // Feedback rows all hang off the permanent fixed round. Clear any
  // leftovers from a crashed prior run before inserting fresh ones, since
  // fromUser is fixed (B or ADMIN) and would otherwise collide with the
  // (round_id, from_user) unique constraint.
  await db.delete(schema.feedback).where(eq(schema.feedback.roundId, fixed.roundId));

  const [feedbackUnreleasedAboutA] = await db
    .insert(schema.feedback)
    .values({
      roundId: fixed.roundId,
      fromUser: fixed.memberBId,
      toUser: memberAId,
      wouldAgain: true,
      releasedAt: null,
    })
    .returning();

  const [feedbackReleasedAboutA] = await db
    .insert(schema.feedback)
    .values({
      roundId: fixed.roundId,
      fromUser: fixed.adminId,
      toUser: memberAId,
      wouldAgain: true,
      releasedAt: new Date(),
    })
    .returning();

  const [feedbackByAAboutB] = await db
    .insert(schema.feedback)
    .values({
      roundId: fixed.roundId,
      fromUser: memberAId,
      toUser: fixed.memberBId,
      wouldAgain: true,
      releasedAt: null,
    })
    .returning();

  const [threadOwned] = await db
    .insert(schema.threads)
    .values({ kind: "round", subjectId: randomUUID() })
    .returning();
  const [threadOther] = await db
    .insert(schema.threads)
    .values({ kind: "round", subjectId: randomUUID() })
    .returning();

  await db.insert(schema.threadMembers).values([{ threadId: threadOwned.id, userId: memberAId }]);
  await db
    .insert(schema.threadMembers)
    .values([{ threadId: threadOther.id, userId: fixed.memberBId }]);

  const [messageOwned] = await db
    .insert(schema.messages)
    .values({ threadId: threadOwned.id, senderId: memberAId, body: "fixture message in A's thread" })
    .returning();
  const [messageOther] = await db
    .insert(schema.messages)
    .values({
      threadId: threadOther.id,
      senderId: fixed.memberBId,
      body: "fixture message in B's thread",
    })
    .returning();

  return {
    runPrefix,
    club2Id: club2.id,
    club4Id: club4.id,
    memberAId,
    memberAEmail,
    applicantId,
    applicantEmail,
    unconfirmedId,
    unconfirmedEmail,
    requestAId: requestA.id,
    requestBId: requestB.id,
    requestUnconfirmedId: requestUnconfirmed.id,
    threadOwnedId: threadOwned.id,
    threadOtherId: threadOther.id,
    messageOwnedId: messageOwned.id,
    messageOtherId: messageOther.id,
    feedbackUnreleasedAboutAId: feedbackUnreleasedAboutA.id,
    feedbackReleasedAboutAId: feedbackReleasedAboutA.id,
    feedbackByAAboutBId: feedbackByAAboutB.id,
  };
}

export async function buildFixtures(): Promise<Fixtures> {
  const admin = supaAdmin();
  const fixed = await buildFixedFixtures(admin);
  const ephemeral = await buildEphemeralFixtures(admin, fixed);
  return { fixed, ephemeral };
}

// --- cross-process handoff -------------------------------------------------
// globalSetup runs once, in a process separate from the forked worker that
// runs the actual test files (even with singleFork). Fixture ids are
// written to a tmp file here so every test file's beforeAll can read them
// back and sign in as each fixture user itself.

const FIXTURES_TMP_PATH = join(tmpdir(), "golfers-connection-rls-fixtures.json");

export function writeFixturesToDisk(fixtures: Fixtures): void {
  writeFileSync(FIXTURES_TMP_PATH, JSON.stringify(fixtures, null, 2), "utf8");
}

export function loadFixtures(): Fixtures {
  const raw = readFileSync(FIXTURES_TMP_PATH, "utf8");
  return JSON.parse(raw) as Fixtures;
}

// --- teardown --------------------------------------------------------------
// Deletes everything ephemeral. Deliberately does NOT touch club1, club3,
// course3, memberB, admin, their membership, requestForRound, offer,
// round, round_participants or the ledger entries — see the file-level
// comment.

export async function teardownFixtures(fixtures: Fixtures): Promise<void> {
  const admin = supaAdmin();
  const { ephemeral } = fixtures;

  await db.delete(schema.messages).where(eq(schema.messages.threadId, ephemeral.threadOwnedId));
  await db.delete(schema.messages).where(eq(schema.messages.threadId, ephemeral.threadOtherId));
  await db
    .delete(schema.threadMembers)
    .where(eq(schema.threadMembers.threadId, ephemeral.threadOwnedId));
  await db
    .delete(schema.threadMembers)
    .where(eq(schema.threadMembers.threadId, ephemeral.threadOtherId));
  await db.delete(schema.threads).where(eq(schema.threads.id, ephemeral.threadOwnedId));
  await db.delete(schema.threads).where(eq(schema.threads.id, ephemeral.threadOtherId));

  await db.delete(schema.feedback).where(eq(schema.feedback.roundId, fixtures.fixed.roundId));

  await db
    .delete(schema.requestTargets)
    .where(eq(schema.requestTargets.requestId, ephemeral.requestAId));
  await db
    .delete(schema.requestTargets)
    .where(eq(schema.requestTargets.requestId, ephemeral.requestBId));
  await db
    .delete(schema.requestTargets)
    .where(eq(schema.requestTargets.requestId, ephemeral.requestUnconfirmedId));

  await db.delete(schema.requests).where(eq(schema.requests.id, ephemeral.requestAId));
  await db.delete(schema.requests).where(eq(schema.requests.id, ephemeral.requestBId));
  await db.delete(schema.requests).where(eq(schema.requests.id, ephemeral.requestUnconfirmedId));

  // Ephemeral host_availability rows created by availability.test.ts's
  // insert assertions — must go before profiles/clubs below, since both
  // are FK targets.
  await db.delete(schema.hostAvailability).where(eq(schema.hostAvailability.userId, ephemeral.memberAId));
  await db
    .delete(schema.hostAvailability)
    .where(eq(schema.hostAvailability.userId, ephemeral.unconfirmedId));

  await db
    .delete(schema.memberships)
    .where(
      and(eq(schema.memberships.userId, ephemeral.memberAId), eq(schema.memberships.clubId, ephemeral.club2Id)),
    );
  await db
    .delete(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, ephemeral.unconfirmedId),
        eq(schema.memberships.clubId, ephemeral.club4Id),
      ),
    );

  await db.delete(schema.profiles).where(eq(schema.profiles.id, ephemeral.memberAId));
  await db.delete(schema.profiles).where(eq(schema.profiles.id, ephemeral.applicantId));
  await db.delete(schema.profiles).where(eq(schema.profiles.id, ephemeral.unconfirmedId));

  await admin.auth.admin.deleteUser(ephemeral.memberAId);
  await admin.auth.admin.deleteUser(ephemeral.applicantId);
  await admin.auth.admin.deleteUser(ephemeral.unconfirmedId);

  await db.delete(schema.clubCourses).where(eq(schema.clubCourses.clubId, ephemeral.club2Id));
  await db.delete(schema.clubCourses).where(eq(schema.clubCourses.clubId, ephemeral.club4Id));
  await db.delete(schema.clubs).where(eq(schema.clubs.id, ephemeral.club2Id));
  await db.delete(schema.clubs).where(eq(schema.clubs.id, ephemeral.club4Id));
}
