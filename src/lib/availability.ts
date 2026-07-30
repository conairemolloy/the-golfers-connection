// Availability service. Server-side only, same conventions as offers.ts
// and requests.ts: every function takes a transaction handle so callers
// compose writes atomically, and every write goes through the
// `postgres` role, bypassing RLS entirely (see CLAUDE.md's THREAT MODEL
// note in 0007_rls_policies.sql).
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { clubCourses, domainEvents, hostAvailability, hostDeclines, memberships, offers, requestTargets, requests } from "@/db/schema";
import type { Tx } from "@/lib/ledger";
import { TERMINAL_OFFER_STATES } from "@/lib/offers";

export type { Tx };

export type AvailabilityErrorCode =
  | "VALIDATION_FAILED"
  | "NO_CONFIRMED_MEMBERSHIP"
  | "COURSE_CLUB_MISMATCH"
  | "AVAILABILITY_NOT_FOUND"
  | "NOT_OWNER"
  | "REQUEST_NOT_FOUND";

export class AvailabilityError extends Error {
  readonly code: AvailabilityErrorCode;
  readonly details?: unknown;

  constructor(code: AvailabilityErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AvailabilityError";
    this.code = code;
    this.details = details;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date");

// Mirrors the host_availability_window_check CHECK constraint (0009) so
// the error is a readable Zod message rather than a raw 23514.
function hasValidWindow(v: { weekday?: number; dateFrom?: string; dateTo?: string }): boolean {
  return v.weekday !== undefined || (v.dateFrom !== undefined && v.dateTo !== undefined);
}

export const declareAvailabilityInputSchema = z
  .object({
    clubId: z.string().uuid(),
    courseId: z.string().uuid().optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    capacity: z.number().int().min(1),
    minTier: z.number().int().min(1).max(4).optional(),
    note: z.string().optional(),
  })
  .refine(hasValidWindow, {
    message: "must give either a weekday or a bounded date range (dateFrom and dateTo), never neither",
    path: ["weekday"],
  })
  .refine((v) => !(v.dateFrom && v.dateTo) || v.dateTo >= v.dateFrom, {
    message: "dateTo must be on or after dateFrom",
    path: ["dateTo"],
  });

export type DeclareAvailabilityInput = z.input<typeof declareAvailabilityInputSchema>;

async function assertConfirmedMembership(tx: Tx, userId: string, clubId: string): Promise<void> {
  const [membership] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.clubId, clubId), eq(memberships.verificationState, "club_confirmed")));
  if (!membership) {
    throw new AvailabilityError("NO_CONFIRMED_MEMBERSHIP", `member ${userId} has no club_confirmed membership at club ${clubId}`);
  }
}

async function assertCourseBelongsToClub(tx: Tx, courseId: string, clubId: string): Promise<void> {
  const [course] = await tx.select().from(clubCourses).where(eq(clubCourses.id, courseId));
  if (!course || course.clubId !== clubId) {
    throw new AvailabilityError("COURSE_CLUB_MISMATCH", `course ${courseId} does not belong to club ${clubId}`);
  }
}

/** A host declaring a standing window. Emits `availability.declared`. */
export async function declareAvailability(
  tx: Tx,
  userId: string,
  input: DeclareAvailabilityInput,
): Promise<{ availabilityId: string }> {
  const parsed = declareAvailabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AvailabilityError("VALIDATION_FAILED", parsed.error.message, parsed.error.issues);
  }
  const data = parsed.data;

  await assertConfirmedMembership(tx, userId, data.clubId);
  if (data.courseId) {
    await assertCourseBelongsToClub(tx, data.courseId, data.clubId);
  }

  const [availability] = await tx
    .insert(hostAvailability)
    .values({
      userId,
      clubId: data.clubId,
      courseId: data.courseId,
      weekday: data.weekday,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      capacity: data.capacity,
      minTier: data.minTier,
      note: data.note,
      active: true,
    })
    .returning();

  await tx.insert(domainEvents).values({
    kind: "availability.declared",
    entity: "host_availability",
    entityId: availability.id,
    payload: { availabilityId: availability.id, userId, clubId: data.clubId },
  });

  return { availabilityId: availability.id };
}

export const updateAvailabilityInputSchema = z.object({
  courseId: z.string().uuid().nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  dateFrom: isoDate.nullable().optional(),
  dateTo: isoDate.nullable().optional(),
  capacity: z.number().int().min(1).optional(),
  minTier: z.number().int().min(1).max(4).nullable().optional(),
  note: z.string().nullable().optional(),
});

export type UpdateAvailabilityInput = z.input<typeof updateAvailabilityInputSchema>;

/** Owner only. Re-validates the recurring-or-bounded window invariant against the merged row. */
export async function updateAvailability(
  tx: Tx,
  userId: string,
  availabilityId: string,
  input: UpdateAvailabilityInput,
): Promise<void> {
  const [existing] = await tx.select().from(hostAvailability).where(eq(hostAvailability.id, availabilityId)).for("update");
  if (!existing) {
    throw new AvailabilityError("AVAILABILITY_NOT_FOUND", `availability ${availabilityId} does not exist`);
  }
  if (existing.userId !== userId) {
    throw new AvailabilityError("NOT_OWNER", `member ${userId} does not own availability ${availabilityId}`);
  }

  const parsed = updateAvailabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AvailabilityError("VALIDATION_FAILED", parsed.error.message, parsed.error.issues);
  }
  const patch = parsed.data;

  const merged = {
    courseId: "courseId" in patch ? patch.courseId : existing.courseId,
    weekday: "weekday" in patch ? patch.weekday : existing.weekday,
    dateFrom: "dateFrom" in patch ? patch.dateFrom : existing.dateFrom,
    dateTo: "dateTo" in patch ? patch.dateTo : existing.dateTo,
    capacity: patch.capacity ?? existing.capacity,
    minTier: "minTier" in patch ? patch.minTier : existing.minTier,
    note: "note" in patch ? patch.note : existing.note,
  };

  if (merged.weekday === null && !(merged.dateFrom && merged.dateTo)) {
    throw new AvailabilityError(
      "VALIDATION_FAILED",
      "must give either a weekday or a bounded date range (dateFrom and dateTo), never neither",
    );
  }
  if (merged.dateFrom && merged.dateTo && merged.dateTo < merged.dateFrom) {
    throw new AvailabilityError("VALIDATION_FAILED", "dateTo must be on or after dateFrom");
  }
  if (merged.courseId) {
    await assertCourseBelongsToClub(tx, merged.courseId, existing.clubId);
  }

  await tx.update(hostAvailability).set(merged).where(eq(hostAvailability.id, availabilityId));
}

/** Owner only. Idempotent — already-inactive is a no-op. */
export async function deactivateAvailability(tx: Tx, userId: string, availabilityId: string): Promise<void> {
  const [existing] = await tx.select().from(hostAvailability).where(eq(hostAvailability.id, availabilityId)).for("update");
  if (!existing) {
    throw new AvailabilityError("AVAILABILITY_NOT_FOUND", `availability ${availabilityId} does not exist`);
  }
  if (existing.userId !== userId) {
    throw new AvailabilityError("NOT_OWNER", `member ${userId} does not own availability ${availabilityId}`);
  }
  if (!existing.active) {
    return;
  }

  await tx.update(hostAvailability).set({ active: false }).where(eq(hostAvailability.id, availabilityId));
}

// --- matching --------------------------------------------------------------

interface WindowLike {
  weekday: number | null;
  dateFrom: string | null;
  dateTo: string | null;
}

interface DateRangeLike {
  dateFrom: string;
  dateTo: string;
}

/** ISO weekday (0 = Monday .. 6 = Sunday) for a YYYY-MM-DD date, matching host_availability.weekday's convention. */
function isoWeekday(dateStr: string): number {
  const jsDay = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday .. 6 = Saturday
  return (jsDay + 6) % 7;
}

function datesOnWeekdayInRange(range: DateRangeLike, weekday: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.dateFrom}T00:00:00Z`);
  const end = new Date(`${range.dateTo}T00:00:00Z`);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (isoWeekday(dateStr) === weekday) {
      dates.push(dateStr);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Whether a window fits a request's date range. A recurring (weekday)
 * window matches when at least one date in the request's range falls on
 * that weekday; a bounded window matches when the two ranges intersect.
 */
function windowMatch(window: WindowLike, range: DateRangeLike): { matches: boolean; matchingDates: string[] | null } {
  if (window.weekday !== null) {
    const dates = datesOnWeekdayInRange(range, window.weekday);
    return { matches: dates.length > 0, matchingDates: dates.length > 0 ? dates : null };
  }
  if (window.dateFrom && window.dateTo) {
    const overlaps = window.dateFrom <= range.dateTo && window.dateTo >= range.dateFrom;
    return { matches: overlaps, matchingDates: null };
  }
  return { matches: false, matchingDates: null };
}

// A window's min_tier is the lowest-prestige requester it will accept —
// tier 1 is the most prestigious, so "the requester's tier is at or
// above" the standard means numerically at or below min_tier. Mirrors
// the >= comparator on request_targets_insert_own_request_within_tier
// (0007), just from the opposite side: that policy asks whether a club
// is prestigious enough for a request; this asks whether a requester is
// prestigious enough for a host's floor.
function tierAllows(minTier: number | null, requesterTier: number | null): boolean {
  if (minTier === null) return true;
  return requesterTier !== null && requesterTier <= minTier;
}

async function getRequesterTier(tx: Tx, userId: string): Promise<number | null> {
  const [{ tier }] = await tx.execute<{ tier: number | null }>(sql`select private.my_tier(${userId}) as "tier"`);
  return tier;
}

export interface AvailabilityMatch {
  availabilityId: string;
  hostId: string;
  clubId: string;
  courseId: string | null;
  weekday: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  capacity: number;
  minTier: number | null;
  note: string | null;
  matchingDates: string[] | null;
}

/**
 * Given an open request, returns the declared windows that fit it. Read-
 * only — this surfaces the request to the right host, it never commits
 * him to anything. A host still has to choose to make an offer.
 */
export async function matchRequestToAvailability(tx: Tx, requestId: string): Promise<AvailabilityMatch[]> {
  const [request] = await tx.select().from(requests).where(eq(requests.id, requestId));
  if (!request) {
    throw new AvailabilityError("REQUEST_NOT_FOUND", `request ${requestId} does not exist`);
  }

  const targetRows = await tx.select({ clubId: requestTargets.clubId }).from(requestTargets).where(eq(requestTargets.requestId, requestId));
  const targetClubIds = targetRows.map((t) => t.clubId);
  if (targetClubIds.length === 0) {
    return [];
  }

  const candidates = await tx
    .select()
    .from(hostAvailability)
    .where(and(eq(hostAvailability.active, true), inArray(hostAvailability.clubId, targetClubIds), ne(hostAvailability.userId, request.userId)));
  if (candidates.length === 0) {
    return [];
  }

  const [requesterTier, liveOfferHosts, declines] = await Promise.all([
    getRequesterTier(tx, request.userId),
    tx
      .select({ hostId: offers.hostId })
      .from(offers)
      .where(and(eq(offers.requestId, requestId), notInArray(offers.state, [...TERMINAL_OFFER_STATES]))),
    tx.select({ hostId: hostDeclines.hostId }).from(hostDeclines).where(eq(hostDeclines.requestId, requestId)),
  ]);
  const excludedHostIds = new Set([...liveOfferHosts.map((r) => r.hostId), ...declines.map((r) => r.hostId)]);

  const matches: AvailabilityMatch[] = [];
  for (const a of candidates) {
    if (excludedHostIds.has(a.userId)) continue;
    if (a.capacity < request.partySize) continue;
    if (!tierAllows(a.minTier, requesterTier)) continue;

    const { matches: windowOk, matchingDates } = windowMatch(a, { dateFrom: request.dateFrom, dateTo: request.dateTo });
    if (!windowOk) continue;

    matches.push({
      availabilityId: a.id,
      hostId: a.userId,
      clubId: a.clubId,
      courseId: a.courseId,
      weekday: a.weekday,
      dateFrom: a.dateFrom,
      dateTo: a.dateTo,
      capacity: a.capacity,
      minTier: a.minTier,
      note: a.note,
      matchingDates,
    });
  }
  return matches;
}

export interface RequestMatch {
  requestId: string;
  requesterId: string;
  dateFrom: string;
  dateTo: string;
  partySize: number;
  matchingDates: string[] | null;
}

/**
 * The inverse of matchRequestToAvailability — what a host sees right
 * after declaring a window: the open requests it could serve. Same
 * exclusions, same read-only guarantee.
 */
export async function matchAvailabilityToRequests(tx: Tx, availabilityId: string): Promise<RequestMatch[]> {
  const [availability] = await tx.select().from(hostAvailability).where(eq(hostAvailability.id, availabilityId));
  if (!availability) {
    throw new AvailabilityError("AVAILABILITY_NOT_FOUND", `availability ${availabilityId} does not exist`);
  }
  if (!availability.active) {
    return [];
  }

  const targetedRequestIds = tx.selectDistinct({ requestId: requestTargets.requestId }).from(requestTargets).where(eq(requestTargets.clubId, availability.clubId));

  const candidateRequests = await tx
    .select()
    .from(requests)
    .where(and(eq(requests.state, "open"), ne(requests.userId, availability.userId), inArray(requests.id, targetedRequestIds)));
  if (candidateRequests.length === 0) {
    return [];
  }

  const requestIds = candidateRequests.map((r) => r.id);
  const [liveOfferRequests, declinedRequests] = await Promise.all([
    tx
      .select({ requestId: offers.requestId })
      .from(offers)
      .where(and(eq(offers.hostId, availability.userId), inArray(offers.requestId, requestIds), notInArray(offers.state, [...TERMINAL_OFFER_STATES]))),
    tx.select({ requestId: hostDeclines.requestId }).from(hostDeclines).where(and(eq(hostDeclines.hostId, availability.userId), inArray(hostDeclines.requestId, requestIds))),
  ]);
  const excludedRequestIds = new Set([...liveOfferRequests.map((r) => r.requestId), ...declinedRequests.map((r) => r.requestId)]);

  const matches: RequestMatch[] = [];
  for (const r of candidateRequests) {
    if (excludedRequestIds.has(r.id)) continue;
    if (availability.capacity < r.partySize) continue;

    const requesterTier = await getRequesterTier(tx, r.userId);
    if (!tierAllows(availability.minTier, requesterTier)) continue;

    const { matches: windowOk, matchingDates } = windowMatch(availability, { dateFrom: r.dateFrom, dateTo: r.dateTo });
    if (!windowOk) continue;

    matches.push({ requestId: r.id, requesterId: r.userId, dateFrom: r.dateFrom, dateTo: r.dateTo, partySize: r.partySize, matchingDates });
  }
  return matches;
}
