// Shared fixture builder for the ledger service test suite. Unlike
// tests/rls, these tests never sign in as anyone — settleRound/
// reverseRound/memberBalance/standing are called directly against a
// transaction on the `postgres` role, exactly as application code will
// call them. There is therefore no cross-process handoff to worry about
// (no supabase-js session state), so each test file just calls
// ensureLedgerFixtures() itself in its own beforeAll.
//
// PERMANENT FIXTURES
// Every scenario round below gets settled, which means it writes real
// ledger_entries rows — append-only, and rounds/offers/requests have no
// cascade into it (see tests/rls/harness.ts for the same constraint).
// So, same pattern, same reasoning: a small pool of members, one club,
// and one round per scenario are found-or-created against a stable
// marker (offers.message) and left in place forever. Named so they can
// never be mistaken for real data:
//   - emails under @ledger-fixture.invalid (RFC 2606 reserved, unroutable)
//   - club name prefixed "ZZ Ledger Fixture — "
//   - offer message (the round marker) prefixed "ZZ Ledger Fixture — "
// Any seed script or club-count/member-count query must exclude rows
// matching those two prefixes and the ledger-fixture.invalid domain,
// same as the rls-fixture.invalid exclusion already required.
//
// The one exception: the "missing confirmation" scenario round is also
// permanent (for consistency — one fixture lifecycle, not two) but is
// deliberately never settled, so it never writes a ledger_entries row.

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import type { Tx } from "@/lib/ledger";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  throw new Error(
    "tests/ledger requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — " +
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

// Runs against the real drizzle instance directly, not through the `db`
// Proxy above — .transaction() is stateful in a way the plain query
// builder methods aren't, and this sidesteps any doubt about the
// Proxy's `receiver` substitution affecting it.
//
// The cast narrows PgDatabase['transaction']'s callback from the base
// PgTransaction type to ledger.ts's Tx (a PostgresJsTransaction, its
// subtype) — the real runtime value postgres-js hands the callback is
// already a PostgresJsTransaction, so this only corrects the type, not
// the behaviour.
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const database = getDb() as unknown as { transaction: (fn: (tx: Tx) => Promise<T>) => Promise<T> };
  return database.transaction(fn);
}

function supaAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const FIXED_EMAIL_DOMAIN = "ledger-fixture.invalid";
const FIXED_CLUB_NAME = "ZZ Ledger Fixture — Club";
const MARKER_PREFIX = "ZZ Ledger Fixture — ";

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
      password: "Ledger-Test-Suite-Passw0rd-1!",
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
      displayName: `ZZ Ledger Fixture — ${label}`,
      initials: label.slice(0, 2).toUpperCase(),
    })
    .where(eq(schema.profiles.id, userId));

  return userId;
}

async function ensureClubAndCourse(): Promise<{ clubId: string; courseId: string }> {
  const existingClub = await db.select().from(schema.clubs).where(eq(schema.clubs.name, FIXED_CLUB_NAME));
  const club =
    existingClub[0] ??
    (
      await db
        .insert(schema.clubs)
        .values({
          name: FIXED_CLUB_NAME,
          region: "Fixture Region",
          country: "IE",
          tier: 2,
          accessDifficulty: 1,
          lat: 53.35,
          lng: -6.26,
          timezone: "Europe/Dublin",
        })
        .returning()
    )[0];

  const existingCourse = await db
    .select()
    .from(schema.clubCourses)
    .where(eq(schema.clubCourses.clubId, club.id));
  const course =
    existingCourse[0] ??
    (
      await db
        .insert(schema.clubCourses)
        .values({ clubId: club.id, name: `${FIXED_CLUB_NAME} Course`, holes: 18, par: 72 })
        .returning()
    )[0];

  return { clubId: club.id, courseId: course.id };
}

export interface GuestSpec {
  userId: string;
  plusOnes?: number;
}

export interface RoundSpec {
  marker: string; // unique per round — becomes the offer's message
  hostId: string;
  guests: GuestSpec[];
  hostConfirmed?: boolean; // default true
  guestConfirmed?: boolean; // default true
}

export async function findOrCreateRound(spec: RoundSpec): Promise<{ roundId: string }> {
  const marker = `${MARKER_PREFIX}${spec.marker}`;

  const existingOffer = await db.select().from(schema.offers).where(eq(schema.offers.message, marker));
  if (existingOffer.length > 0) {
    const [existingRound] = await db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.offerId, existingOffer[0].id));
    return { roundId: existingRound.id };
  }

  const { clubId, courseId } = await ensureClubAndCourse();

  const [request] = await db
    .insert(schema.requests)
    .values({
      userId: spec.hostId,
      region: "Fixture Region",
      dateFrom: "2025-06-01",
      dateTo: "2025-06-10",
      partySize: spec.guests.length,
      state: "filled",
      expiresAt: new Date("2025-07-01T00:00:00Z"),
    })
    .returning();

  const [offer] = await db
    .insert(schema.offers)
    .values({
      requestId: request.id,
      hostId: spec.hostId,
      clubId,
      courseId,
      teeAtLocal: new Date("2025-06-05T09:00:00"),
      teeTimezone: "Europe/Dublin",
      state: "confirmed",
      message: marker,
    })
    .returning();

  const hostConfirmed = spec.hostConfirmed ?? true;
  const guestConfirmed = spec.guestConfirmed ?? true;

  const [round] = await db
    .insert(schema.rounds)
    .values({
      offerId: offer.id,
      courseId,
      playedOn: "2025-06-05",
      hostId: spec.hostId,
      hostConfirmedAt: hostConfirmed ? new Date("2025-06-05T14:00:00Z") : null,
      guestConfirmedAt: guestConfirmed ? new Date("2025-06-05T14:05:00Z") : null,
    })
    .returning();

  const participantRows: (typeof schema.roundParticipants.$inferInsert)[] = [
    { roundId: round.id, userId: spec.hostId, isMember: true, role: "host" },
  ];
  for (const guest of spec.guests) {
    participantRows.push({ roundId: round.id, userId: guest.userId, isMember: true, role: "guest" });
    for (let i = 0; i < (guest.plusOnes ?? 0); i++) {
      participantRows.push({
        roundId: round.id,
        userId: null,
        guestName: `${marker} — plus-one ${i + 1} of ${guest.userId.slice(0, 8)}`,
        isMember: false,
        invitedBy: guest.userId,
        role: "guest",
      });
    }
  }
  await db.insert(schema.roundParticipants).values(participantRows);

  return { roundId: round.id };
}

export interface LedgerFixtures {
  memberA: string;
  memberB: string;
  memberC: string;
  memberD: string;
  memberE: string;
  standingBalancePositive1: string;
  standingBalanceZero: string;
  standingBalanceNeg1: string;
  standingBalanceNeg2: string;
  standingBalanceNeg3: string;
  standingBalanceNeg5: string;
  anchorRoundId: string; // a settled round, used as the FK anchor for the
  // hand-crafted standing-test ledger entries below
}

let fixturesPromise: Promise<LedgerFixtures> | undefined;

export function ensureLedgerFixtures(): Promise<LedgerFixtures> {
  if (!fixturesPromise) {
    fixturesPromise = buildLedgerFixtures();
  }
  return fixturesPromise;
}

async function buildLedgerFixtures(): Promise<LedgerFixtures> {
  const [memberA, memberB, memberC, memberD, memberE] = await Promise.all([
    ensureMemberProfile("member-a"),
    ensureMemberProfile("member-b"),
    ensureMemberProfile("member-c"),
    ensureMemberProfile("member-d"),
    ensureMemberProfile("member-e"),
  ]);

  const [
    standingBalancePositive1,
    standingBalanceZero,
    standingBalanceNeg1,
    standingBalanceNeg2,
    standingBalanceNeg3,
    standingBalanceNeg5,
  ] = await Promise.all([
    ensureMemberProfile("standing-pos-1"),
    ensureMemberProfile("standing-zero"),
    ensureMemberProfile("standing-neg-1"),
    ensureMemberProfile("standing-neg-2"),
    ensureMemberProfile("standing-neg-3"),
    ensureMemberProfile("standing-neg-5"),
  ]);

  // Dedicated anchor round, never settled, never touched by any settle.ts
  // scenario — it exists purely to give the hand-crafted standing-test
  // entries below a valid round_id FK target. ledger_entries.round_id
  // doesn't require its user_id to be a round_participants row on that
  // round, so this doesn't need real participants matching the standing
  // members; it must NOT be a round any settle scenario also writes to,
  // or its entry count would include these too.
  const { roundId: anchorRoundId } = await findOrCreateRound({
    marker: "standing-anchor: fk target for hand-crafted balance entries",
    hostId: memberA,
    guests: [{ userId: memberB }],
  });

  const standingEntries: { userId: string; amount: number; direction: "credit" | "debit" }[] = [
    { userId: standingBalancePositive1, amount: 1, direction: "credit" },
    { userId: standingBalanceNeg1, amount: 1, direction: "debit" },
    { userId: standingBalanceNeg2, amount: 2, direction: "debit" },
    { userId: standingBalanceNeg3, amount: 3, direction: "debit" },
    { userId: standingBalanceNeg5, amount: 5, direction: "debit" },
  ];
  await db
    .insert(schema.ledgerEntries)
    .values(
      standingEntries.map((e) => ({
        userId: e.userId,
        roundId: anchorRoundId,
        direction: e.direction,
        amount: e.amount,
        reason: "ZZ Ledger Fixture — standing test anchor entry",
        idempotencyKey: `ledger-fixture-standing:${e.userId}:${e.direction}`,
      })),
    )
    .onConflictDoNothing();

  return {
    memberA,
    memberB,
    memberC,
    memberD,
    memberE,
    standingBalancePositive1,
    standingBalanceZero,
    standingBalanceNeg1,
    standingBalanceNeg2,
    standingBalanceNeg3,
    standingBalanceNeg5,
    anchorRoundId,
  };
}

// Used by property.test.ts to give each iteration's round a unique but
// deterministic marker without a database round-trip to check for
// collisions.
export function propertyIterationMarker(seed: number, iteration: number): string {
  return `property seed=${seed} iter=${iteration}`;
}
