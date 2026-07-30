// Request service. Server-side only, same conventions as ledger.ts:
// every function takes a transaction handle so callers compose writes
// atomically, and every write goes through the `postgres` role,
// bypassing RLS entirely (see CLAUDE.md's THREAT MODEL note in
// 0007_rls_policies.sql).
import { and, count, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { domainEvents, memberships, offers, profiles, requestTargets, requests } from "@/db/schema";
import { standing, type Tx } from "@/lib/ledger";

export type { Tx };

export type RequestErrorCode =
  | "VALIDATION_FAILED"
  | "STANDING_CLOSED"
  | "NO_CONFIRMED_MEMBERSHIP"
  | "CLUB_TIER_TOO_HIGH"
  | "REQUEST_NOT_FOUND"
  | "NOT_OWNER";

export class RequestError extends Error {
  readonly code: RequestErrorCode;
  readonly details?: unknown;

  constructor(code: RequestErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.details = details;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date");

export const createRequestInputSchema = z
  .object({
    region: z.string().min(1),
    dateFrom: isoDate,
    dateTo: isoDate,
    partySize: z.number().int().min(1).max(8),
    handicaps: z.string().optional(),
    flexibility: z.string().optional(),
    note: z.string().optional(),
    pacePreference: z.enum(["brisk", "steady", "no_preference"]).optional(),
    targetClubIds: z.array(z.string().uuid()).min(1, "at least one target club is required"),
  })
  .refine((v) => v.dateTo >= v.dateFrom, {
    message: "dateTo must be on or after dateFrom",
    path: ["dateTo"],
  })
  .refine((v) => v.dateFrom >= todayIso(), {
    message: "dateFrom cannot be in the past",
    path: ["dateFrom"],
  });

export type CreateRequestInput = z.input<typeof createRequestInputSchema>;

/**
 * Creates a request and its request_targets in one transaction.
 *
 * The tier check reuses private.my_tier(uuid) — the same SQL formula
 * the request_targets_insert_own_request_within_tier RLS policy
 * enforces (0013_my_tier_parameterized.sql) — rather than re-deriving
 * the comparison here. A member with no club_confirmed membership gets
 * NULL back and fails closed, same as the policy: NULL >= anything is
 * NULL, not true.
 */
export async function createRequest(
  tx: Tx,
  userId: string,
  input: CreateRequestInput,
): Promise<{ requestId: string }> {
  const parsed = createRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RequestError("VALIDATION_FAILED", parsed.error.message, parsed.error.issues);
  }
  const data = parsed.data;

  const memberStanding = await standing(tx, userId);
  if (!memberStanding.canRequest) {
    throw new RequestError(
      "STANDING_CLOSED",
      `member ${userId} standing is '${memberStanding.state}' and cannot create a request`,
    );
  }

  const [{ myTier }] = await tx.execute<{ myTier: number | null }>(
    sql`select private.my_tier(${userId}) as "myTier"`,
  );

  if (myTier === null) {
    throw new RequestError(
      "NO_CONFIRMED_MEMBERSHIP",
      `member ${userId} has no club_confirmed membership and cannot target any club`,
    );
  }

  const targetClubs = await tx
    .select({ id: schema.clubs.id, tier: schema.clubs.tier })
    .from(schema.clubs)
    .where(inArray(schema.clubs.id, data.targetClubIds));

  const tooHigh = targetClubs.filter((c) => c.tier < myTier);
  if (tooHigh.length > 0) {
    throw new RequestError(
      "CLUB_TIER_TOO_HIGH",
      `target club(s) ${tooHigh.map((c) => c.id).join(", ")} are above member ${userId}'s tier (${myTier})`,
    );
  }

  const dayBeforeDeparture = new Date(`${data.dateFrom}T00:00:00Z`);
  dayBeforeDeparture.setUTCDate(dayBeforeDeparture.getUTCDate() - 1);
  const ninetyDaysFromNow = new Date();
  ninetyDaysFromNow.setUTCDate(ninetyDaysFromNow.getUTCDate() + 90);
  const expiresAt = dayBeforeDeparture < ninetyDaysFromNow ? dayBeforeDeparture : ninetyDaysFromNow;

  const [request] = await tx
    .insert(requests)
    .values({
      userId,
      region: data.region,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      partySize: data.partySize,
      handicaps: data.handicaps,
      flexibility: data.flexibility,
      note: data.note,
      pacePreference: data.pacePreference,
      state: "open",
      expiresAt,
    })
    .returning();

  await tx
    .insert(requestTargets)
    .values(data.targetClubIds.map((clubId) => ({ requestId: request.id, clubId })));

  await tx.insert(domainEvents).values({
    kind: "request.created",
    entity: "request",
    entityId: request.id,
    payload: { requestId: request.id, targetClubIds: data.targetClubIds },
  });

  return { requestId: request.id };
}

/** Owner only. No-op if already withdrawn. */
export async function withdrawRequest(tx: Tx, userId: string, requestId: string): Promise<void> {
  const [request] = await tx.select().from(requests).where(eq(requests.id, requestId)).for("update");
  if (!request) {
    throw new RequestError("REQUEST_NOT_FOUND", `request ${requestId} does not exist`);
  }
  if (request.userId !== userId) {
    throw new RequestError("NOT_OWNER", `member ${userId} does not own request ${requestId}`);
  }
  if (request.state === "withdrawn") {
    return;
  }

  await tx.update(requests).set({ state: "withdrawn" }).where(eq(requests.id, requestId));

  await tx.insert(domainEvents).values({
    kind: "request.withdrawn",
    entity: "request",
    entityId: requestId,
    payload: { requestId },
  });
}

export interface ExpireRequestsResult {
  expiredCount: number;
  unfilledCount: number;
}

/**
 * Every open request past expires_at -> 'expired'. The payload on each
 * request.expired event is the point of this function, not the state
 * change itself: unfilled requests are the Access Index and the
 * evidence for club-side release.
 */
export async function expireRequests(tx: Tx): Promise<ExpireRequestsResult> {
  const now = new Date();
  const candidates = await tx
    .select()
    .from(requests)
    .where(and(eq(requests.state, "open"), lt(requests.expiresAt, now)));

  let unfilledCount = 0;

  for (const request of candidates) {
    const [offerRows, targetRows] = await Promise.all([
      tx.select({ id: offers.id }).from(offers).where(eq(offers.requestId, request.id)),
      tx.select({ clubId: requestTargets.clubId }).from(requestTargets).where(eq(requestTargets.requestId, request.id)),
    ]);
    const unfilled = offerRows.length === 0;
    if (unfilled) unfilledCount++;

    await tx.update(requests).set({ state: "expired" }).where(eq(requests.id, request.id));

    await tx.insert(domainEvents).values({
      kind: "request.expired",
      entity: "request",
      entityId: request.id,
      payload: {
        requestId: request.id,
        unfilled,
        targetClubIds: targetRows.map((r) => r.clubId),
      },
    });
  }

  return { expiredCount: candidates.length, unfilledCount };
}

// --- shared read-model helpers -------------------------------------------

export interface RequestListEntry {
  requestId: string;
  state: (typeof schema.requestState.enumValues)[number];
  dateFrom: string;
  dateTo: string;
  partySize: number;
  handicaps: string | null;
  flexibility: string | null;
  pacePreference: "brisk" | "steady" | "no_preference" | null;
  targetClubIds: string[];
  offerCount: number;
}

async function attachTargetsAndOfferCounts(
  tx: Tx,
  rows: (typeof requests.$inferSelect)[],
): Promise<{ targetsByRequest: Map<string, string[]>; offerCountByRequest: Map<string, number> }> {
  const requestIds = rows.map((r) => r.id);
  if (requestIds.length === 0) {
    return { targetsByRequest: new Map(), offerCountByRequest: new Map() };
  }

  const [targets, offerCounts] = await Promise.all([
    tx.select().from(requestTargets).where(inArray(requestTargets.requestId, requestIds)),
    tx
      .select({ requestId: offers.requestId, offerCount: count() })
      .from(offers)
      .where(inArray(offers.requestId, requestIds))
      .groupBy(offers.requestId),
  ]);

  const targetsByRequest = new Map<string, string[]>();
  for (const t of targets) {
    const existing = targetsByRequest.get(t.requestId);
    if (existing) {
      existing.push(t.clubId);
    } else {
      targetsByRequest.set(t.requestId, [t.clubId]);
    }
  }

  const offerCountByRequest = new Map(offerCounts.map((o) => [o.requestId, Number(o.offerCount)]));

  return { targetsByRequest, offerCountByRequest };
}

/** All states, newest first, with offer counts. */
export async function myRequests(tx: Tx, userId: string): Promise<RequestListEntry[]> {
  const rows = await tx
    .select()
    .from(requests)
    .where(eq(requests.userId, userId))
    .orderBy(desc(requests.createdAt), desc(requests.id));

  const { targetsByRequest, offerCountByRequest } = await attachTargetsAndOfferCounts(tx, rows);

  return rows.map((r) => ({
    requestId: r.id,
    state: r.state,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    partySize: r.partySize,
    handicaps: r.handicaps,
    flexibility: r.flexibility,
    pacePreference: r.pacePreference,
    targetClubIds: targetsByRequest.get(r.id) ?? [],
    offerCount: offerCountByRequest.get(r.id) ?? 0,
  }));
}

export interface BookEntry extends RequestListEntry {
  requesterId: string;
  requesterDisplayName: string | null; // null when the requester is in discretion mode
  requesterInitials: string | null;
  requesterHomeClubId: string | null;
  discretionMode: boolean;
  note: string | null;
}

export interface ListBookOptions {
  limit?: number;
  cursor?: string;
  clubId?: string;
}

export interface ListBookPage {
  entries: BookEntry[];
  nextCursor: string | null;
}

function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}_${id}`;
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const separatorIndex = cursor.lastIndexOf("_");
  return {
    createdAt: new Date(cursor.slice(0, separatorIndex)),
    id: cursor.slice(separatorIndex + 1),
  };
}

/**
 * The Book as a member sees it: open requests, excluding the caller's
 * own, restricted to requests targeting a club where the caller holds a
 * club_confirmed membership — a member only sees requests he could
 * actually offer to host. Cursor pagination is keyset (created_at, id),
 * not offset, so a row inserted mid-pagination can't shift later pages.
 */
export async function listBook(tx: Tx, userId: string, opts: ListBookOptions = {}): Promise<ListBookPage> {
  const limit = opts.limit ?? 20;

  const confirmedClubRows = await tx
    .select({ clubId: memberships.clubId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.verificationState, "club_confirmed")));
  let confirmedClubIds = confirmedClubRows.map((m) => m.clubId);
  if (opts.clubId) {
    confirmedClubIds = confirmedClubIds.filter((id) => id === opts.clubId);
  }
  if (confirmedClubIds.length === 0) {
    return { entries: [], nextCursor: null };
  }

  const targetedRequestIds = tx
    .selectDistinct({ requestId: requestTargets.requestId })
    .from(requestTargets)
    .where(inArray(requestTargets.clubId, confirmedClubIds));

  const conditions = [
    eq(requests.state, "open"),
    ne(requests.userId, userId),
    inArray(requests.id, targetedRequestIds),
  ];

  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor);
    const cursorCondition = or(
      lt(requests.createdAt, cursor.createdAt),
      and(eq(requests.createdAt, cursor.createdAt), lt(requests.id, cursor.id)),
    );
    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  // Fetch one extra row to know whether there's a next page, without a
  // second round trip.
  const rows = await tx
    .select()
    .from(requests)
    .where(and(...conditions))
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const requesterIds = [...new Set(pageRows.map((r) => r.userId))];
  const [{ targetsByRequest, offerCountByRequest }, requesters] = await Promise.all([
    attachTargetsAndOfferCounts(tx, pageRows),
    requesterIds.length > 0
      ? tx.select().from(profiles).where(inArray(profiles.id, requesterIds))
      : Promise.resolve([] as (typeof profiles.$inferSelect)[]),
  ]);
  const requesterById = new Map(requesters.map((p) => [p.id, p]));

  const entries: BookEntry[] = pageRows.map((r) => {
    const requester = requesterById.get(r.userId);
    const discretion = requester?.discretionMode ?? false;
    return {
      requestId: r.id,
      state: r.state,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      partySize: r.partySize,
      handicaps: r.handicaps,
      flexibility: r.flexibility,
      note: r.note,
      pacePreference: r.pacePreference,
      targetClubIds: targetsByRequest.get(r.id) ?? [],
      offerCount: offerCountByRequest.get(r.id) ?? 0,
      requesterId: r.userId,
      requesterDisplayName: discretion ? null : (requester?.displayName ?? null),
      requesterInitials: requester?.initials ?? null,
      requesterHomeClubId: requester?.homeClubId ?? null,
      discretionMode: discretion,
    };
  });

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return { entries, nextCursor };
}
