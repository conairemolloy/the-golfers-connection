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
//
// property.test.ts is a second exception, in the other direction: it
// runs its whole 100-iteration loop inside one transaction it rolls
// back, via buildEphemeralRound below (not findOrCreateRound — there is
// nothing to find-or-create when nothing survives the test). See that
// file for why.
//
// The pg client, closeDb, withTransaction and supaAdmin all live in
// tests/support — see that module for the full reasoning behind each.

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Tx } from "@/lib/ledger";
import { assertTestEnv, db, ensureProfile } from "../support";

assertTestEnv("tests/ledger");

export { closeDb, db, withTransaction } from "../support";

const FIXED_EMAIL_DOMAIN = "ledger-fixture.invalid";
const FIXED_CLUB_NAME = "ZZ Ledger Fixture — Club";
const MARKER_PREFIX = "ZZ Ledger Fixture — ";

export async function ensureClubAndCourse(): Promise<{ clubId: string; courseId: string }> {
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

// Shared between findOrCreateRound (permanent, via `db`) and
// buildEphemeralRound (rolled back, via a caller-supplied `tx`) — the row
// shape is identical either way, only whether it survives differs.
function buildParticipantRows(
  roundId: string,
  hostId: string,
  guests: GuestSpec[],
  guestNamePrefix: string,
): (typeof schema.roundParticipants.$inferInsert)[] {
  const rows: (typeof schema.roundParticipants.$inferInsert)[] = [
    { roundId, userId: hostId, isMember: true, role: "host" },
  ];
  for (const guest of guests) {
    rows.push({ roundId, userId: guest.userId, isMember: true, role: "guest" });
    for (let i = 0; i < (guest.plusOnes ?? 0); i++) {
      rows.push({
        roundId,
        userId: null,
        guestName: `${guestNamePrefix} — plus-one ${i + 1} of ${guest.userId.slice(0, 8)}`,
        isMember: false,
        invitedBy: guest.userId,
        role: "guest",
      });
    }
  }
  return rows;
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

  const participantRows = buildParticipantRows(round.id, spec.hostId, spec.guests, marker);
  await db.insert(schema.roundParticipants).values(participantRows);

  return { roundId: round.id };
}

export interface EphemeralRoundSpec {
  hostId: string;
  guests: GuestSpec[];
  clubId: string;
  courseId: string;
}

// For the property test only: builds a request/offer/round/participants
// chain on the caller's transaction, with no existence check and no
// stable marker — there is nothing to find-or-create, because the whole
// transaction is rolled back at the end and none of it is meant to
// survive. See property.test.ts for why.
export async function buildEphemeralRound(tx: Tx, spec: EphemeralRoundSpec): Promise<{ roundId: string }> {
  const [request] = await tx
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

  const [offer] = await tx
    .insert(schema.offers)
    .values({
      requestId: request.id,
      hostId: spec.hostId,
      clubId: spec.clubId,
      courseId: spec.courseId,
      teeAtLocal: new Date("2025-06-05T09:00:00"),
      teeTimezone: "Europe/Dublin",
      state: "confirmed",
      message: "ZZ Ledger Fixture — property test iteration (rolled back)",
    })
    .returning();

  const [round] = await tx
    .insert(schema.rounds)
    .values({
      offerId: offer.id,
      courseId: spec.courseId,
      playedOn: "2025-06-05",
      hostId: spec.hostId,
      hostConfirmedAt: new Date("2025-06-05T14:00:00Z"),
      guestConfirmedAt: new Date("2025-06-05T14:05:00Z"),
    })
    .returning();

  const participantRows = buildParticipantRows(round.id, spec.hostId, spec.guests, "property test");
  await tx.insert(schema.roundParticipants).values(participantRows);

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
  const opts = { domain: FIXED_EMAIL_DOMAIN, markerPrefix: MARKER_PREFIX };
  const [memberA, memberB, memberC, memberD, memberE] = await Promise.all([
    ensureProfile("member-a", opts),
    ensureProfile("member-b", opts),
    ensureProfile("member-c", opts),
    ensureProfile("member-d", opts),
    ensureProfile("member-e", opts),
  ]);

  const [
    standingBalancePositive1,
    standingBalanceZero,
    standingBalanceNeg1,
    standingBalanceNeg2,
    standingBalanceNeg3,
    standingBalanceNeg5,
  ] = await Promise.all([
    ensureProfile("standing-pos-1", opts),
    ensureProfile("standing-zero", opts),
    ensureProfile("standing-neg-1", opts),
    ensureProfile("standing-neg-2", opts),
    ensureProfile("standing-neg-3", opts),
    ensureProfile("standing-neg-5", opts),
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
