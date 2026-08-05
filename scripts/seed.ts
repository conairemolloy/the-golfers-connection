// M0 dev/production seed script. Run via `pnpm seed`; `pnpm seed --reset`
// tears down the non-ledger-linked slice of it. See ROADMAP.md's "Seed
// Data Is Real Data" section and this file's own comments for the shape
// of what it builds.
//
// Every write that has a real service function (createRequest, makeOffer,
// acceptOffer, confirmRound, fillRequest, withdrawRequest,
// declareAvailability) goes through it, not a raw insert — the same rule
// tests/requests, tests/offers and tests/availability follow, so this
// script exercises the exact paths production does and can't drift from
// them. Clubs, courses, profiles, memberships and handicaps have no
// service layer (M1 schema only), so those are plain upserts.
//
// IDEMPOTENCY. Clubs/courses upsert on name (clubs) / (club, name)
// (courses) — editing clubs.json and re-running corrects existing rows
// in place. Members upsert on email. Memberships/handicaps/availability
// find-or-create on their natural key. Requests are found again on
// requests.seed_key rather than on (user, dateFrom, dateTo) — a
// date-based key would silently start duplicating requests the day
// after first running this, since dateFrom must be >= today at creation
// time and "today" moves. seed_key makes re-running on any later day a
// no-op, which is what "run it twice" actually needs to prove. It's a
// dedicated column rather than a marker embedded in note, because note
// is member-facing copy rendered on the Book card. Once a request is
// found, offers/accept/confirm/fill each re-check current state before
// acting, so a second run resumes a partially-seeded scenario rather
// than erroring or duplicating.
//
// FIXTURE EXCLUSION. tests/rls leaves a permanent fixture chain in this
// same database (see tests/rls/harness.ts): clubs named
// "ZZ RLS Fixture — ..." and members at @rls-fixture.invalid. Every
// count this script prints excludes any "ZZ ... Fixture — " club name
// and any *-fixture.invalid email domain, so the summary reports only
// what this script owns, per CLAUDE.md/ROADMAP.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { standing, type Tx } from "@/lib/ledger";
import { createRequest, withdrawRequest } from "@/lib/requests";
import { makeOffer, acceptOffer, confirmRound, fillRequest } from "@/lib/offers";
import { declareAvailability } from "@/lib/availability";

const client = postgres(env.DATABASE_URL);
const db = drizzle(client, { schema });

// createClient() below constructs a realtime client eagerly even though
// this script never uses realtime, and that construction throws on
// Node 20 without a global WebSocket. package.json's "seed" script sets
// NODE_OPTIONS=--experimental-websocket for exactly this reason — the
// same gap vitest.config.ts's execArgv works around for the test
// suites. It has to be NODE_OPTIONS rather than a CLI flag on the outer
// `node` invocation (which is how the test suites do it) because this
// script runs through tsx's CLI, which respawns node without inheriting
// execArgv; NODE_OPTIONS is read by every node process, including that
// respawn. Drop it once this project moves to Node 22+.
function supaAdmin(): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const SEED_DOMAIN = "seed.invalid";
const SEED_PASSWORD = "Seed-Data-Not-Real-Passw0rd-1!";
const FIXTURE_CLUB_PATTERN = "ZZ%Fixture — %";
const FIXTURE_EMAIL_PATTERN = "%-fixture.invalid";
const SEED_EMAIL_PATTERN = `%@${SEED_DOMAIN}`;

// drizzle's `sql` tag spreads a plain JS array interpolation into
// individual placeholders (`($1, $2, ...)`, a row list), not a single
// Postgres array parameter — `= any(...)` needs the latter. Building the
// `{...}` literal text ourselves and casting it (`::uuid[]`) sidesteps
// that. Safe against injection here because every id is a uuid string
// this script already read back from the database, never user input.
function uuidArrayLiteral(ids: string[]): string {
  return `{${ids.join(",")}}`;
}

function offsetDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// --- clubs.json --------------------------------------------------------

interface ClubCourseSeed {
  name: string;
  holes: number;
  par: number;
  outBearing: number | null;
  inBearing: number | null;
}

interface ClubSeed {
  name: string;
  region: string;
  country: string;
  tier: number;
  accessDifficulty: number;
  lat: number;
  lng: number;
  timezone: string;
  guestFeePence: number | null;
  courses: ClubCourseSeed[];
}

function loadClubsJson(): ClubSeed[] {
  const path = fileURLToPath(new URL("../src/db/seed/clubs.json", import.meta.url));
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { clubs: ClubSeed[] };
  return parsed.clubs;
}

/**
 * Upserts every club and its courses, keyed on name (clubs) and
 * (clubId, name) (courses). True upsert, not find-or-skip: re-running
 * after editing clubs.json corrects tier/fee/bearing changes on
 * existing rows, matching "the file is appended to over time" from
 * ROADMAP.md. Returns club ids and the first course id per club, in
 * clubs.json's own order — everything downstream indexes into this
 * script's MEMBERS/SCENARIOS tables by that same position.
 */
async function upsertClubsAndCourses(
  tx: Tx,
  clubs: ClubSeed[],
): Promise<{ clubIds: string[]; firstCourseIdByClubId: Map<string, string> }> {
  const clubIds: string[] = [];
  const firstCourseIdByClubId = new Map<string, string>();

  for (const c of clubs) {
    const [existing] = await tx.select({ id: schema.clubs.id }).from(schema.clubs).where(eq(schema.clubs.name, c.name));
    let clubId: string;
    if (existing) {
      clubId = existing.id;
      await tx
        .update(schema.clubs)
        .set({
          region: c.region,
          country: c.country,
          tier: c.tier,
          accessDifficulty: c.accessDifficulty,
          lat: c.lat,
          lng: c.lng,
          timezone: c.timezone,
          guestFeePence: c.guestFeePence,
        })
        .where(eq(schema.clubs.id, clubId));
    } else {
      const [inserted] = await tx
        .insert(schema.clubs)
        .values({
          name: c.name,
          region: c.region,
          country: c.country,
          tier: c.tier,
          accessDifficulty: c.accessDifficulty,
          lat: c.lat,
          lng: c.lng,
          timezone: c.timezone,
          guestFeePence: c.guestFeePence,
        })
        .returning();
      clubId = inserted.id;
    }
    clubIds.push(clubId);

    let firstCourseId: string | undefined;
    for (const course of c.courses) {
      const [existingCourse] = await tx
        .select({ id: schema.clubCourses.id })
        .from(schema.clubCourses)
        .where(and(eq(schema.clubCourses.clubId, clubId), eq(schema.clubCourses.name, course.name)));
      let courseId: string;
      if (existingCourse) {
        courseId = existingCourse.id;
        await tx
          .update(schema.clubCourses)
          .set({ holes: course.holes, par: course.par, outBearing: course.outBearing, inBearing: course.inBearing })
          .where(eq(schema.clubCourses.id, courseId));
      } else {
        const [insertedCourse] = await tx
          .insert(schema.clubCourses)
          .values({
            clubId,
            name: course.name,
            holes: course.holes,
            par: course.par,
            outBearing: course.outBearing,
            inBearing: course.inBearing,
          })
          .returning();
        courseId = insertedCourse.id;
      }
      firstCourseId ??= courseId;
    }
    firstCourseIdByClubId.set(clubId, firstCourseId!);
  }

  return { clubIds, firstCourseIdByClubId };
}

// --- members -------------------------------------------------------------
// 20 synthetic members, indexed 0-19. Indices 1, 2, 3, 11, 12, 13, 14, 15
// are the "protected" pool — they host or guest in the 8 settled-round
// scenarios below, which means they pick up ledger entries and become
// permanent (see resetSeed). Every other index is the "generic" pool,
// used for the open/offered/accepted/withdrawn scenarios and fully
// removable by --reset. clubIdx/secondClubIdx index into clubs.json's
// array (same order upsertClubsAndCourses returns clubIds in).

interface MemberSeed {
  label: string;
  displayName: string;
  initials: string;
  handicapIndex: string;
  discretionMode: boolean;
  clubIdx: number;
  secondClubIdx?: number;
}

const MEMBERS: MemberSeed[] = [
  { label: "james-whitfield", displayName: "James Whitfield", initials: "JW", handicapIndex: "4.2", discretionMode: false, clubIdx: 0, secondClubIdx: 7 },
  { label: "robert-hanley", displayName: "Robert Hanley", initials: "RH", handicapIndex: "12.5", discretionMode: false, clubIdx: 1 },
  { label: "andrew-fitzgerald", displayName: "Andrew Fitzgerald", initials: "AF", handicapIndex: "8.1", discretionMode: false, clubIdx: 2, secondClubIdx: 9 },
  { label: "william-ashworth", displayName: "William Ashworth", initials: "WA", handicapIndex: "18.3", discretionMode: false, clubIdx: 3 },
  { label: "peter-callaghan", displayName: "Peter Callaghan", initials: "PC", handicapIndex: "2.4", discretionMode: false, clubIdx: 4, secondClubIdx: 11 },
  { label: "david-sinclair", displayName: "David Sinclair", initials: "DS", handicapIndex: "24.0", discretionMode: true, clubIdx: 5 },
  { label: "charles-mulqueen", displayName: "Charles Mulqueen", initials: "CM", handicapIndex: "14.7", discretionMode: false, clubIdx: 6, secondClubIdx: 19 },
  { label: "thomas-beresford", displayName: "Thomas Beresford", initials: "TB", handicapIndex: "9.9", discretionMode: false, clubIdx: 7 },
  { label: "richard-gormley", displayName: "Richard Gormley", initials: "RG", handicapIndex: "6.6", discretionMode: false, clubIdx: 8, secondClubIdx: 15 },
  { label: "edward-blackwood", displayName: "Edward Blackwood", initials: "EB", handicapIndex: "20.1", discretionMode: false, clubIdx: 9 },
  { label: "henry-concannon", displayName: "Henry Concannon", initials: "HC", handicapIndex: "11.3", discretionMode: false, clubIdx: 10, secondClubIdx: 17 },
  { label: "george-faulkner", displayName: "George Faulkner", initials: "GF", handicapIndex: "3.8", discretionMode: false, clubIdx: 11 },
  { label: "john-ridgeway", displayName: "John Ridgeway", initials: "JR", handicapIndex: "16.5", discretionMode: false, clubIdx: 12, secondClubIdx: 19 },
  { label: "patrick-loughlin", displayName: "Patrick Loughlin", initials: "PL", handicapIndex: "7.2", discretionMode: false, clubIdx: 13 },
  { label: "simon-wexford", displayName: "Simon Wexford", initials: "SW", handicapIndex: "22.4", discretionMode: false, clubIdx: 14, secondClubIdx: 1 },
  { label: "nigel-ashcombe", displayName: "Nigel Ashcombe", initials: "NA", handicapIndex: "5.5", discretionMode: true, clubIdx: 15 },
  { label: "alistair-munro", displayName: "Alistair Munro", initials: "AM", handicapIndex: "13.9", discretionMode: false, clubIdx: 16, secondClubIdx: 3 },
  { label: "oliver-kavanagh", displayName: "Oliver Kavanagh", initials: "OK", handicapIndex: "1.2", discretionMode: false, clubIdx: 17 },
  { label: "francis-delaney", displayName: "Francis Delaney", initials: "FD", handicapIndex: "19.8", discretionMode: false, clubIdx: 18, secondClubIdx: 5 },
  { label: "michael-doran", displayName: "Michael Doran", initials: "MD", handicapIndex: "10.0", discretionMode: false, clubIdx: 19 },
];

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`select id from auth.users where email = ${email} limit 1`);
  return rows[0]?.id ?? null;
}

async function upsertMembers(admin: SupabaseClient): Promise<string[]> {
  const memberIds: string[] = [];
  for (const m of MEMBERS) {
    const email = `${m.label}@${SEED_DOMAIN}`;
    let userId = await findAuthUserIdByEmail(email);
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
      if (error || !data.user) {
        throw new Error(`createUser failed for ${email}: ${error?.message}`);
      }
      userId = data.user.id;
    }
    // status/displayName/initials land in one UPDATE — profiles_member_needs_name_check
    // (0006) is checked at statement end, not deferred.
    await db
      .update(schema.profiles)
      .set({ status: "member", displayName: m.displayName, initials: m.initials, discretionMode: m.discretionMode })
      .where(eq(schema.profiles.id, userId));
    memberIds.push(userId);
  }
  return memberIds;
}

async function ensureMembership(userId: string, clubId: string, memberSince: number): Promise<void> {
  const [existing] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.clubId, clubId)));
  if (existing) return;
  await db.insert(schema.memberships).values({
    userId,
    clubId,
    verificationState: "club_confirmed",
    confirmedAt: new Date(),
    memberSince,
  });
}

async function upsertMemberships(memberIds: string[], clubIds: string[]): Promise<void> {
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const memberSince = 2026 - (3 + (i % 15));
    await ensureMembership(memberIds[i], clubIds[m.clubIdx], memberSince);
    if (m.secondClubIdx !== undefined) {
      await ensureMembership(memberIds[i], clubIds[m.secondClubIdx], memberSince);
    }
  }
}

async function upsertHandicaps(memberIds: string[]): Promise<void> {
  for (let i = 0; i < MEMBERS.length; i++) {
    const [existing] = await db
      .select({ userId: schema.handicaps.userId })
      .from(schema.handicaps)
      .where(eq(schema.handicaps.userId, memberIds[i]));
    if (existing) continue;
    await db.insert(schema.handicaps).values({
      userId: memberIds[i],
      handicapIndex: MEMBERS[i].handicapIndex,
      source: "seed",
      locked: true,
    });
  }
}

// About half the roster declares a standing weekday window, at their
// primary club. Uses the real declareAvailability service.
const AVAILABILITY_INDICES = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];

async function declareAvailabilityWindows(memberIds: string[], clubIds: string[]): Promise<void> {
  for (const idx of AVAILABILITY_INDICES) {
    const marker = `[[seed:avail-${idx}]]`;
    const [existing] = await db
      .select({ id: schema.hostAvailability.id })
      .from(schema.hostAvailability)
      .where(and(eq(schema.hostAvailability.userId, memberIds[idx]), like(schema.hostAvailability.note, `%${marker}%`)));
    if (existing) continue;

    await db.transaction(async (tx) => {
      await declareAvailability(tx, memberIds[idx], {
        clubId: clubIds[MEMBERS[idx].clubIdx],
        weekday: idx % 7,
        capacity: (idx % 2) + 1,
        note: `Standing weekend window. ${marker}`,
      });
    });
  }
}

// --- request/offer/round scenarios ---------------------------------------
//
// 30 requests. 8 are hand-designed to reach settlement with specific
// hosts/guests, so the standing distribution reliably includes both an
// 'owing' and a 'closed' member (see the per-request comments below);
// the other 22 are generated across open/offered/accepted/withdrawn
// buckets. Every target club satisfies requests.ts's tier rule (target
// club's tier >= requester's own tier — "I may request into my tier or
// a worse one"), checked by hand against clubs.json's tier assignments
// when this table was written.

type ScenarioBucket = "open" | "offered" | "accepted" | "settled" | "withdrawn";

interface ScenarioDef {
  key: string;
  requesterIdx: number;
  targetIdxs: number[];
  bucket: ScenarioBucket;
  hostIdxs?: number[]; // offer-making hosts, in the order offers are made
  dateFromOffset: number;
  dateToOffset: number;
  teeOffsetDays?: number; // offered/accepted only — settled always uses today
  teeHour: string;
  note: string;
}

const SCENARIOS: ScenarioDef[] = [
  // --- settled: host pool {1,2,3} vs guest pool {11..15}, all tier 1 ---
  // Guest 11 (Prestwick) guests 3x, never hosts -> balance -3 -> closed.
  { key: "req-01", requesterIdx: 11, targetIdxs: [1], bucket: "settled", hostIdxs: [1], dateFromOffset: 3, dateToOffset: 6, teeHour: "08:00", note: "A weekend across for the members' outing." },
  { key: "req-02", requesterIdx: 11, targetIdxs: [1], bucket: "settled", hostIdxs: [1], dateFromOffset: 10, dateToOffset: 12, teeHour: "08:10", note: "Back again while I'm over for business." },
  { key: "req-03", requesterIdx: 11, targetIdxs: [1], bucket: "settled", hostIdxs: [1], dateFromOffset: 20, dateToOffset: 22, teeHour: "08:20", note: "Third trip this season — can't stay away." },
  // Guest 12 (Muirfield) guests 2x, never hosts -> balance -2 -> owing.
  { key: "req-04", requesterIdx: 12, targetIdxs: [2], bucket: "settled", hostIdxs: [2], dateFromOffset: 5, dateToOffset: 8, teeHour: "08:30", note: "Fancied a look at Portmarnock before the Amateur." },
  { key: "req-05", requesterIdx: 12, targetIdxs: [2], bucket: "settled", hostIdxs: [2], dateFromOffset: 15, dateToOffset: 17, teeHour: "08:40", note: "One more round while the forecast holds." },
  // Guests 13, 14, 15 guest once each -> balance -1 -> owing (extra coverage).
  { key: "req-06", requesterIdx: 13, targetIdxs: [3], bucket: "settled", hostIdxs: [3], dateFromOffset: 7, dateToOffset: 9, teeHour: "08:50", note: "Heading north for a few days on the Dornoch coast." },
  { key: "req-07", requesterIdx: 14, targetIdxs: [2], bucket: "settled", hostIdxs: [2], dateFromOffset: 9, dateToOffset: 11, teeHour: "09:00", note: "Over for the golf writers' dinner, hoping to get a game in." },
  { key: "req-08", requesterIdx: 15, targetIdxs: [3], bucket: "settled", hostIdxs: [3], dateFromOffset: 12, dateToOffset: 14, teeHour: "09:10", note: "Extending the trip north after the Open." },

  // --- open, no offer yet ---
  { key: "req-09", requesterIdx: 0, targetIdxs: [1], bucket: "open", dateFromOffset: 14, dateToOffset: 17, teeHour: "09:00", note: "Thinking about a long weekend at Portrush in the autumn." },
  { key: "req-10", requesterIdx: 4, targetIdxs: [5, 6], bucket: "open", dateFromOffset: 30, dateToOffset: 34, teeHour: "09:00", note: "A few days on the Clare/Kerry coast — flexible on exact course." },
  { key: "req-11", requesterIdx: 5, targetIdxs: [18], bucket: "open", dateFromOffset: 45, dateToOffset: 48, teeHour: "09:00", note: "Crossing for a client trip near Liverpool, hoping to fit in a round." },
  { key: "req-12", requesterIdx: 6, targetIdxs: [16, 17], bucket: "open", dateFromOffset: 60, dateToOffset: 64, teeHour: "09:00", note: "Heading south for a few days, open to either course." },
  { key: "req-13", requesterIdx: 7, targetIdxs: [9], bucket: "open", dateFromOffset: 21, dateToOffset: 22, teeHour: "09:00", note: "Quick hop over to Belfast for the weekend." },
  { key: "req-14", requesterIdx: 8, targetIdxs: [10], bucket: "open", dateFromOffset: 75, dateToOffset: 78, teeHour: "09:00", note: "Lincolnshire in the spring, if anyone's about." },

  // --- open, with offer(s), not accepted ---
  { key: "req-15", requesterIdx: 10, targetIdxs: [8], bucket: "offered", hostIdxs: [8], dateFromOffset: 10, dateToOffset: 13, teeOffsetDays: 12, teeHour: "10:00", note: "Fancied Castlerock while the weather holds." },
  { key: "req-16", requesterIdx: 16, targetIdxs: [17], bucket: "offered", hostIdxs: [17], dateFromOffset: 18, dateToOffset: 20, teeOffsetDays: 19, teeHour: "10:00", note: "Never played the European Club — overdue." },
  { key: "req-17", requesterIdx: 17, targetIdxs: [9], bucket: "offered", hostIdxs: [9], dateFromOffset: 8, dateToOffset: 9, teeOffsetDays: 8, teeHour: "10:00", note: "Malone's on my list for this year." },
  // Two competing offers: club19's primary member (19) plus member 6, who
  // holds a secondary confirmed membership there.
  { key: "req-18", requesterIdx: 18, targetIdxs: [19], bucket: "offered", hostIdxs: [19, 6], dateFromOffset: 25, dateToOffset: 28, teeOffsetDays: 26, teeHour: "10:00", note: "Kent in early autumn — flexible on dates." },
  { key: "req-19", requesterIdx: 19, targetIdxs: [4], bucket: "offered", hostIdxs: [4], dateFromOffset: 16, dateToOffset: 18, teeOffsetDays: 17, teeHour: "10:00", note: "A short trip north before the season ends." },
  { key: "req-20", requesterIdx: 0, targetIdxs: [7], bucket: "offered", hostIdxs: [7], dateFromOffset: 40, dateToOffset: 44, teeOffsetDays: 42, teeHour: "10:00", note: "Fancied Rosses Point for the views alone." },

  // --- accepted, round created, not yet confirmed (tee time in the future) ---
  { key: "req-21", requesterIdx: 4, targetIdxs: [16], bucket: "accepted", hostIdxs: [16], dateFromOffset: 12, dateToOffset: 15, teeOffsetDays: 14, teeHour: "11:00", note: "Confirmed for Waterville next month." },
  { key: "req-22", requesterIdx: 5, targetIdxs: [17], bucket: "accepted", hostIdxs: [17], dateFromOffset: 16, dateToOffset: 19, teeOffsetDays: 18, teeHour: "11:00", note: "Booked in at the European Club." },
  { key: "req-23", requesterIdx: 6, targetIdxs: [8], bucket: "accepted", hostIdxs: [8], dateFromOffset: 19, dateToOffset: 22, teeOffsetDays: 21, teeHour: "11:00", note: "Game's on for Castlerock." },
  { key: "req-24", requesterIdx: 7, targetIdxs: [10], bucket: "accepted", hostIdxs: [10], dateFromOffset: 23, dateToOffset: 26, teeOffsetDays: 25, teeHour: "11:00", note: "Woodhall Spa booked — looking forward to the Hotchkin." },
  { key: "req-25", requesterIdx: 8, targetIdxs: [9], bucket: "accepted", hostIdxs: [9], dateFromOffset: 27, dateToOffset: 30, teeOffsetDays: 29, teeHour: "11:00", note: "Malone's on, first week of the month." },
  { key: "req-26", requesterIdx: 10, targetIdxs: [16], bucket: "accepted", hostIdxs: [16], dateFromOffset: 32, dateToOffset: 35, teeOffsetDays: 34, teeHour: "11:00", note: "Back to Waterville again — twice in one year." },

  // --- withdrawn ---
  { key: "req-27", requesterIdx: 16, targetIdxs: [5], bucket: "withdrawn", dateFromOffset: 50, dateToOffset: 53, teeHour: "09:00", note: "Had this in for Lahinch but plans changed." },
  { key: "req-28", requesterIdx: 17, targetIdxs: [10], bucket: "withdrawn", dateFromOffset: 55, dateToOffset: 58, teeHour: "09:00", note: "Woodhall Spa trip fell through." },
  { key: "req-29", requesterIdx: 18, targetIdxs: [7], bucket: "withdrawn", dateFromOffset: 42, dateToOffset: 45, teeHour: "09:00", note: "Withdrawing — dates no longer work." },
  { key: "req-30", requesterIdx: 19, targetIdxs: [8], bucket: "withdrawn", dateFromOffset: 48, dateToOffset: 51, teeHour: "09:00", note: "No longer travelling that week." },
];

async function processScenario(
  tx: Tx,
  scenario: ScenarioDef,
  memberIds: string[],
  clubIds: string[],
  firstCourseIdByClubId: Map<string, string>,
  clubData: ClubSeed[],
): Promise<void> {
  const requesterId = memberIds[scenario.requesterIdx];

  const [existingRequest] = await tx
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.seedKey, scenario.key));

  let requestId: string;
  if (existingRequest) {
    requestId = existingRequest.id;
  } else {
    const targetClubIds = scenario.targetIdxs.map((i) => clubIds[i]);
    const { requestId: newId } = await createRequest(tx, requesterId, {
      region: clubData[scenario.targetIdxs[0]].region,
      dateFrom: offsetDate(scenario.dateFromOffset),
      dateTo: offsetDate(scenario.dateToOffset),
      partySize: 1,
      note: scenario.note,
      targetClubIds,
    });
    requestId = newId;
    // createRequest has no notion of a seed key — it's a dev-only
    // bookkeeping concern for this script's idempotent lookup, stamped
    // on after the real service call rather than threaded through it.
    await tx.update(schema.requests).set({ seedKey: scenario.key }).where(eq(schema.requests.id, requestId));
  }

  if (scenario.bucket === "open") return;

  if (scenario.bucket === "withdrawn") {
    const [request] = await tx.select({ state: schema.requests.state }).from(schema.requests).where(eq(schema.requests.id, requestId));
    if (request.state !== "withdrawn") {
      await withdrawRequest(tx, requesterId, requestId);
    }
    return;
  }

  // offered / accepted / settled all make at least one offer.
  const hostIdxs = scenario.hostIdxs ?? [];
  const primaryHostIdx = hostIdxs[0];
  const clubId = clubIds[scenario.targetIdxs[0]];
  const courseId = firstCourseIdByClubId.get(clubId)!;
  const teeTimezone = clubData[scenario.targetIdxs[0]].timezone;
  const teeDate = scenario.bucket === "settled" ? offsetDate(0) : offsetDate(scenario.teeOffsetDays ?? 14);

  let primaryOfferId: string | undefined;
  for (const hostIdx of hostIdxs) {
    const hostId = memberIds[hostIdx];
    const [existingOffer] = await tx
      .select({ id: schema.offers.id })
      .from(schema.offers)
      .where(and(eq(schema.offers.requestId, requestId), eq(schema.offers.hostId, hostId)));

    const offerId = existingOffer
      ? existingOffer.id
      : (
          await makeOffer(tx, hostId, requestId, {
            clubId,
            courseId,
            teeAtLocal: `${teeDate}T${scenario.teeHour}`,
            teeTimezone,
          })
        ).offerId;

    if (hostIdx === primaryHostIdx) primaryOfferId = offerId;
  }

  if (scenario.bucket === "offered") return;

  // accepted / settled: progress the primary offer.
  const [offerRow] = await tx.select().from(schema.offers).where(eq(schema.offers.id, primaryOfferId!));
  let roundId: string | undefined;
  if (offerRow.state === "offered") {
    roundId = (await acceptOffer(tx, requesterId, primaryOfferId!)).roundId;
  } else {
    const [round] = await tx.select({ id: schema.rounds.id }).from(schema.rounds).where(eq(schema.rounds.offerId, primaryOfferId!));
    roundId = round?.id;
  }

  if (scenario.bucket === "accepted" || !roundId) return;

  // settled: confirm both sides, then close the request explicitly —
  // one accepted offer doesn't fill a request on its own (ROADMAP
  // decision log), the requester (or expiry) has to say so.
  const [round] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
  const hostId = memberIds[primaryHostIdx];
  if (!round.hostConfirmedAt) await confirmRound(tx, hostId, roundId);
  if (!round.guestConfirmedAt) await confirmRound(tx, requesterId, roundId);

  const [request] = await tx.select({ state: schema.requests.state }).from(schema.requests).where(eq(schema.requests.id, requestId));
  if (request.state !== "filled") {
    await fillRequest(tx, requesterId, requestId);
  }
}

// --- summary ---------------------------------------------------------------

async function printSummary(): Promise<void> {
  const [{ count: clubCount }] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from clubs where name not like ${FIXTURE_CLUB_PATTERN}`,
  );
  const [{ count: courseCount }] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from club_courses cc join clubs c on c.id = cc.club_id where c.name not like ${FIXTURE_CLUB_PATTERN}`,
  );
  const [{ count: memberCount }] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from profiles p join auth.users u on u.id = p.id where u.email not like ${FIXTURE_EMAIL_PATTERN} and p.status = 'member'`,
  );
  const requestsByState = await db.execute<{ state: string; count: string }>(sql`
    select r.state as state, count(*)::text as count
    from requests r join profiles p on p.id = r.user_id join auth.users u on u.id = p.id
    where u.email not like ${FIXTURE_EMAIL_PATTERN}
    group by r.state
  `);
  const [{ count: roundCount }] = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from rounds r join profiles p on p.id = r.host_id join auth.users u on u.id = p.id
    where u.email not like ${FIXTURE_EMAIL_PATTERN}
  `);
  const [{ count: ledgerCount }] = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from ledger_entries le join profiles p on p.id = le.user_id join auth.users u on u.id = p.id
    where u.email not like ${FIXTURE_EMAIL_PATTERN}
  `);

  const nonFixtureMembers = await db.execute<{ id: string }>(sql`
    select p.id from profiles p join auth.users u on u.id = p.id
    where u.email not like ${FIXTURE_EMAIL_PATTERN} and p.status = 'member'
  `);
  let good = 0;
  let owing = 0;
  let closed = 0;
  await db.transaction(async (tx) => {
    for (const row of nonFixtureMembers) {
      const s = await standing(tx, row.id);
      if (s.state === "good") good++;
      else if (s.state === "owing") owing++;
      else closed++;
    }
  });

  console.log("\n--- seed summary (excludes RLS fixture rows) ---");
  console.log(`clubs:   ${clubCount}`);
  console.log(`courses: ${courseCount}`);
  console.log(`members: ${memberCount}`);
  console.log("requests by state:");
  for (const row of requestsByState) {
    console.log(`  ${row.state}: ${row.count}`);
  }
  console.log(`rounds:  ${roundCount}`);
  console.log(`ledger entries: ${ledgerCount}`);
  console.log(`standing: good=${good} owing=${owing} closed=${closed}`);
  console.log("---------------------------------------------\n");
}

// --- --reset -----------------------------------------------------------

/**
 * Deletes every @seed.invalid member's requests, offers, rounds,
 * threads, availability and memberships — but never a round with a
 * ledger entry, nor anything that round's ledger entries transitively
 * pin in place (its offer, its request, its host and guests). Those
 * stay forever, same as tests/rls's own permanent fixture chain: ledger
 * rows are append-only, so once a member has one, that member's profile
 * can never be deleted either (FK from ledger_entries.user_id).
 */
// Supabase project refs are opaque random strings with no "dev"/"prod" in
// the name, so a substring guess against DATABASE_URL doesn't work — and
// per ROADMAP.md's Setup & Accounts checklist, the prod project doesn't
// exist yet, so there is exactly one project today. This is that
// project's ref (from NEXT_PUBLIC_SUPABASE_URL, https://<ref>.supabase.co),
// pinned by hand rather than guessed. Update it if the dev project is ever
// recreated under a different ref, and add the prod ref to an explicit
// blocklist once prod is provisioned (ROADMAP.md's "Supabase prod
// project" box) rather than relying on this allowlist alone.
const DEV_PROJECT_REF = "sebfcvbaylhyxvelabdd";

async function resetSeed(): Promise<void> {
  const looksLikeDev = env.DATABASE_URL.includes(DEV_PROJECT_REF) || env.NEXT_PUBLIC_SUPABASE_URL.includes(DEV_PROJECT_REF);
  if (!looksLikeDev) {
    console.error(
      `Refusing --reset: neither DATABASE_URL nor NEXT_PUBLIC_SUPABASE_URL references the known dev project (${DEV_PROJECT_REF}). ` +
        "--reset only ever runs against golfers-connection-dev (ROADMAP.md). If the dev project has genuinely moved, " +
        "update DEV_PROJECT_REF in scripts/seed.ts before running --reset again.",
    );
    process.exitCode = 1;
    return;
  }

  const admin = supaAdmin();

  const protectedRoundIds = (await db.execute<{ id: string }>(sql`select distinct round_id as id from ledger_entries`)).map((r) => r.id);
  const protectedRoundIdsArr = uuidArrayLiteral(protectedRoundIds);
  const protectedOfferIds = (
    await db.execute<{ id: string }>(sql`select offer_id as id from rounds where id = any(${protectedRoundIdsArr}::uuid[])`)
  ).map((r) => r.id);
  const protectedOfferIdsArr = uuidArrayLiteral(protectedOfferIds);
  const protectedRequestIds = (
    await db.execute<{ id: string }>(sql`select request_id as id from offers where id = any(${protectedOfferIdsArr}::uuid[])`)
  ).map((r) => r.id);
  const protectedRequestIdsArr = uuidArrayLiteral(protectedRequestIds);
  const protectedUserIds = (
    await db.execute<{ id: string }>(sql`
      select user_id as id from ledger_entries
      union select host_id as id from rounds where id = any(${protectedRoundIdsArr}::uuid[])
      union select user_id as id from round_participants where round_id = any(${protectedRoundIdsArr}::uuid[]) and user_id is not null
      union select host_id as id from offers where id = any(${protectedOfferIdsArr}::uuid[])
      union select user_id as id from requests where id = any(${protectedRequestIdsArr}::uuid[])
    `)
  ).map((r) => r.id);

  const seedUserIds = (
    await db.execute<{ id: string }>(sql`select p.id from profiles p join auth.users u on u.id = p.id where u.email like ${SEED_EMAIL_PATTERN}`)
  ).map((r) => r.id);

  const protectedSeedUserIds = seedUserIds.filter((id) => protectedUserIds.includes(id));
  const deletableUserIds = seedUserIds.filter((id) => !protectedUserIds.includes(id));
  const deletableUserIdsArr = uuidArrayLiteral(deletableUserIds);

  if (deletableUserIds.length > 0) {
    const deletableRounds = sql`(select id from rounds where host_id = any(${deletableUserIdsArr}::uuid[]) and not (id = any(${protectedRoundIdsArr}::uuid[])))`;
    const deletableOffers = sql`(select id from offers where host_id = any(${deletableUserIdsArr}::uuid[]) and not (id = any(${protectedOfferIdsArr}::uuid[])))`;
    const deletableRequests = sql`(select id from requests where user_id = any(${deletableUserIdsArr}::uuid[]) and not (id = any(${protectedRequestIdsArr}::uuid[])))`;

    // Children before parents: messages/threads -> round_participants ->
    // rounds -> offers -> host_declines/request_targets -> requests ->
    // availability/handicaps/memberships -> profiles -> auth.users.
    await db.execute(sql`delete from messages where sender_id = any(${deletableUserIdsArr}::uuid[])`);
    await db.execute(sql`delete from thread_members where thread_id in (select id from threads where subject_id in ${deletableRounds})`);
    await db.execute(sql`delete from threads where subject_id in ${deletableRounds}`);
    await db.execute(sql`delete from round_participants where round_id in ${deletableRounds}`);
    await db.execute(sql`delete from rounds where id in ${deletableRounds}`);
    await db.execute(sql`delete from offers where id in ${deletableOffers}`);
    await db.execute(sql`delete from host_declines where host_id = any(${deletableUserIdsArr}::uuid[])`);
    await db.execute(sql`delete from request_targets where request_id in ${deletableRequests}`);
    await db.execute(sql`delete from requests where id in ${deletableRequests}`);
    await db.execute(sql`delete from host_availability where user_id = any(${deletableUserIdsArr}::uuid[])`);
    await db.execute(sql`delete from handicaps where user_id = any(${deletableUserIdsArr}::uuid[])`);
    await db.execute(sql`delete from memberships where user_id = any(${deletableUserIdsArr}::uuid[])`);
    await db.execute(sql`delete from profiles where id = any(${deletableUserIdsArr}::uuid[])`);

    for (const userId of deletableUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.error(`  failed to delete auth user ${userId}: ${error.message}`);
    }
    console.log(
      `--reset: deleted ${deletableUserIds.length} non-ledger-linked @seed.invalid member(s) and their requests, offers, rounds, threads, availability and memberships. Clubs and courses were left in place (never deleted).`,
    );
  } else {
    console.log("--reset: no non-ledger-linked @seed.invalid members to delete.");
  }

  if (protectedSeedUserIds.length > 0) {
    console.log(
      `--reset: ${protectedSeedUserIds.length} @seed.invalid member(s) are ledger-linked and were left untouched, along with their ` +
        "settled round(s), offer(s), request(s) and ledger entries. ledger_entries is append-only (UPDATE/DELETE revoked at the " +
        "database level) — these rows are permanent, the same way tests/rls/harness.ts's own fixed fixture chain is permanent. " +
        "Re-running `pnpm seed` will find these members already in place and pick up where it left off.",
    );
  }
}

// --- main ------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.argv.includes("--reset")) {
    await resetSeed();
    return;
  }

  const clubData = loadClubsJson();
  const { clubIds, firstCourseIdByClubId } = await db.transaction((tx) => upsertClubsAndCourses(tx, clubData));

  const admin = supaAdmin();
  const memberIds = await upsertMembers(admin);
  await upsertMemberships(memberIds, clubIds);
  await upsertHandicaps(memberIds);
  await declareAvailabilityWindows(memberIds, clubIds);

  for (const scenario of SCENARIOS) {
    await db.transaction((tx) => processScenario(tx, scenario, memberIds, clubIds, firstCourseIdByClubId, clubData));
  }

  await printSummary();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
