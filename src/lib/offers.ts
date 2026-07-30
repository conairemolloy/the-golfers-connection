// Offer service. Server-side only, same conventions as ledger.ts and
// requests.ts: every function takes a transaction handle so callers
// compose writes atomically, and every write goes through the
// `postgres` role, bypassing RLS entirely (see CLAUDE.md's THREAT MODEL
// note in 0007_rls_policies.sql).
import { and, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  clubCourses,
  domainEvents,
  memberships,
  offers,
  requestTargets,
  requests,
  roundParticipants,
  rounds,
  threadMembers,
  threads,
} from "@/db/schema";
import { reverseRound, settleRound, type Tx } from "@/lib/ledger";

export type { Tx };

// Offer states that represent a live, still-actionable offer. A host may
// re-offer on the same request after withdrawing, being declined, or
// having a round cancelled — only one row per (request, host) may be
// live at a time, not one ever. Kept in sync with the partial unique
// index offers_request_id_host_id_live_unique (migration 0015).
const TERMINAL_OFFER_STATES = ["withdrawn", "declined", "expired", "cancelled"] as const;

export type OfferErrorCode =
  | "VALIDATION_FAILED"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_NOT_OPEN"
  | "OWN_REQUEST"
  | "NO_CONFIRMED_MEMBERSHIP"
  | "COURSE_CLUB_MISMATCH"
  | "CLUB_NOT_TARGETED"
  | "DUPLICATE_LIVE_OFFER"
  | "OFFER_NOT_FOUND"
  | "NOT_HOST"
  | "NOT_OFFERED"
  | "NOT_OWNER"
  | "ROUND_NOT_FOUND"
  | "NOT_PARTICIPANT"
  | "ROUND_IN_FUTURE"
  | "ROUND_CANCELLED";

export class OfferError extends Error {
  readonly code: OfferErrorCode;
  readonly details?: unknown;

  constructor(code: OfferErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "OfferError";
    this.code = code;
    this.details = details;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// No offset — tee_timezone carries it, same convention as the
// teeAtLocal column comment in schema.ts.
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "must be a local date-time with no offset, e.g. 2026-08-05T09:00");

export const makeOfferInputSchema = z.object({
  clubId: z.string().uuid(),
  courseId: z.string().uuid(),
  teeAtLocal: localDateTime,
  teeTimezone: z.string().min(1),
  message: z.string().optional(),
});

export type MakeOfferInput = z.input<typeof makeOfferInputSchema>;

export interface MakeOfferResult {
  offerId: string;
  outsideRequestedDates: boolean;
}

/**
 * Deliberately does NOT check standing — hosting is never gated on it.
 * A member deep in debit should be encouraged to host, not blocked from
 * it. createRequest checks standing (src/lib/requests.ts); this function
 * must not, by design. Do not "fix" this into symmetry with createRequest.
 */
export async function makeOffer(
  tx: Tx,
  hostId: string,
  requestId: string,
  input: MakeOfferInput,
): Promise<MakeOfferResult> {
  const parsed = makeOfferInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new OfferError("VALIDATION_FAILED", parsed.error.message, parsed.error.issues);
  }
  const data = parsed.data;

  const [request] = await tx.select().from(requests).where(eq(requests.id, requestId));
  if (!request) {
    throw new OfferError("REQUEST_NOT_FOUND", `request ${requestId} does not exist`);
  }
  if (request.state !== "open") {
    throw new OfferError("REQUEST_NOT_OPEN", `request ${requestId} is '${request.state}', not open`);
  }
  if (request.userId === hostId) {
    throw new OfferError("OWN_REQUEST", `member ${hostId} cannot offer to host their own request`);
  }

  const [membership] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, hostId),
        eq(memberships.clubId, data.clubId),
        eq(memberships.verificationState, "club_confirmed"),
      ),
    );
  if (!membership) {
    throw new OfferError(
      "NO_CONFIRMED_MEMBERSHIP",
      `member ${hostId} has no club_confirmed membership at club ${data.clubId}`,
    );
  }

  const [course] = await tx.select().from(clubCourses).where(eq(clubCourses.id, data.courseId));
  if (!course || course.clubId !== data.clubId) {
    throw new OfferError(
      "COURSE_CLUB_MISMATCH",
      `course ${data.courseId} does not belong to club ${data.clubId}`,
    );
  }

  const [target] = await tx
    .select()
    .from(requestTargets)
    .where(and(eq(requestTargets.requestId, requestId), eq(requestTargets.clubId, data.clubId)));
  if (!target) {
    throw new OfferError("CLUB_NOT_TARGETED", `club ${data.clubId} is not a target of request ${requestId}`);
  }

  const [existingLiveOffer] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(
      and(
        eq(offers.requestId, requestId),
        eq(offers.hostId, hostId),
        notInArray(offers.state, [...TERMINAL_OFFER_STATES]),
      ),
    );
  if (existingLiveOffer) {
    throw new OfferError(
      "DUPLICATE_LIVE_OFFER",
      `member ${hostId} already has a live offer on request ${requestId}`,
    );
  }

  const teeDate = data.teeAtLocal.slice(0, 10);
  const outsideRequestedDates = teeDate < request.dateFrom || teeDate > request.dateTo;

  const [offer] = await tx
    .insert(offers)
    .values({
      requestId,
      hostId,
      clubId: data.clubId,
      courseId: data.courseId,
      teeAtLocal: new Date(data.teeAtLocal),
      teeTimezone: data.teeTimezone,
      message: data.message,
      state: "offered",
    })
    .returning();

  await tx.insert(domainEvents).values({
    kind: "offer.made",
    entity: "offer",
    entityId: offer.id,
    payload: { offerId: offer.id, requestId, hostId, clubId: data.clubId, outsideRequestedDates },
  });

  return { offerId: offer.id, outsideRequestedDates };
}

/** Host only, only from 'offered'. Idempotent — already-withdrawn is a no-op. */
export async function withdrawOffer(tx: Tx, hostId: string, offerId: string): Promise<void> {
  const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for("update");
  if (!offer) {
    throw new OfferError("OFFER_NOT_FOUND", `offer ${offerId} does not exist`);
  }
  if (offer.hostId !== hostId) {
    throw new OfferError("NOT_HOST", `member ${hostId} is not the host of offer ${offerId}`);
  }
  if (offer.state === "withdrawn") {
    return;
  }
  if (offer.state !== "offered") {
    throw new OfferError("NOT_OFFERED", `offer ${offerId} is '${offer.state}', not 'offered'`);
  }

  await tx.update(offers).set({ state: "withdrawn" }).where(eq(offers.id, offerId));

  await tx.insert(domainEvents).values({
    kind: "offer.withdrawn",
    entity: "offer",
    entityId: offerId,
    payload: { offerId },
  });
}

/** The requester turning down a specific offer. Request owner only, only from 'offered'. Idempotent. */
export async function rejectOffer(
  tx: Tx,
  requesterId: string,
  offerId: string,
  note?: string,
): Promise<void> {
  const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for("update");
  if (!offer) {
    throw new OfferError("OFFER_NOT_FOUND", `offer ${offerId} does not exist`);
  }

  const [request] = await tx.select().from(requests).where(eq(requests.id, offer.requestId));
  if (!request || request.userId !== requesterId) {
    throw new OfferError("NOT_OWNER", `member ${requesterId} does not own request ${offer.requestId}`);
  }
  if (offer.state === "declined") {
    return;
  }
  if (offer.state !== "offered") {
    throw new OfferError("NOT_OFFERED", `offer ${offerId} is '${offer.state}', not 'offered'`);
  }

  await tx.update(offers).set({ state: "declined" }).where(eq(offers.id, offerId));

  await tx.insert(domainEvents).values({
    kind: "offer.rejected",
    entity: "offer",
    entityId: offerId,
    payload: { offerId, requestId: offer.requestId, note },
  });
}

export const acceptOfferOptionsSchema = z.object({
  plusOnes: z.array(z.string().min(1)).optional(),
});

export type AcceptOfferOptions = z.input<typeof acceptOfferOptionsSchema>;

export interface AcceptOfferResult {
  roundId: string;
  threadId: string;
}

/**
 * One accepted offer does not fill a request — a request is trip-shaped
 * and may name several clubs, so a member may accept several offers
 * against it. The requester closes it explicitly via fillRequest.
 *
 * Thread creation lives here rather than in a separate M5 step: per the
 * domain rule (CLAUDE.md), a thread may only be created by an accepted
 * offer, an itinerary, or a fixture, and acceptance is the first of
 * those. Messages themselves are M5.
 */
export async function acceptOffer(
  tx: Tx,
  requesterId: string,
  offerId: string,
  opts: AcceptOfferOptions = {},
): Promise<AcceptOfferResult> {
  const parsedOpts = acceptOfferOptionsSchema.safeParse(opts);
  if (!parsedOpts.success) {
    throw new OfferError("VALIDATION_FAILED", parsedOpts.error.message, parsedOpts.error.issues);
  }
  const plusOnes = parsedOpts.data.plusOnes ?? [];

  const [offer] = await tx.select().from(offers).where(eq(offers.id, offerId)).for("update");
  if (!offer) {
    throw new OfferError("OFFER_NOT_FOUND", `offer ${offerId} does not exist`);
  }

  const [request] = await tx.select().from(requests).where(eq(requests.id, offer.requestId));
  if (!request || request.userId !== requesterId) {
    throw new OfferError("NOT_OWNER", `member ${requesterId} does not own request ${offer.requestId}`);
  }
  if (request.state !== "open") {
    throw new OfferError("REQUEST_NOT_OPEN", `request ${offer.requestId} is '${request.state}', not open`);
  }
  if (offer.state !== "offered") {
    throw new OfferError("NOT_OFFERED", `offer ${offerId} is '${offer.state}', not 'offered'`);
  }

  await tx.update(offers).set({ state: "accepted" }).where(eq(offers.id, offerId));

  // tee_at_local is a "timestamp without time zone" column — casting to
  // ::date in SQL reads back the literal calendar date as stored, with
  // no dependence on the JS Date object's local-vs-UTC interpretation
  // (which would otherwise risk shifting the date near midnight
  // depending on the server process's system timezone).
  const [{ playedOn }] = await tx.execute<{ playedOn: string }>(
    sql`select tee_at_local::date as "playedOn" from offers where id = ${offerId}`,
  );
  const [round] = await tx
    .insert(rounds)
    .values({ offerId, courseId: offer.courseId, hostId: offer.hostId, playedOn })
    .returning();

  await tx.insert(roundParticipants).values([
    { roundId: round.id, userId: offer.hostId, isMember: true, role: "host" },
    { roundId: round.id, userId: requesterId, isMember: true, role: "guest" },
    ...plusOnes.map((guestName) => ({
      roundId: round.id,
      userId: null,
      guestName,
      isMember: false,
      invitedBy: requesterId,
      role: "guest" as const,
    })),
  ]);

  const [thread] = await tx.insert(threads).values({ kind: "round", subjectId: round.id }).returning();
  await tx.insert(threadMembers).values([
    { threadId: thread.id, userId: offer.hostId },
    { threadId: thread.id, userId: requesterId },
  ]);

  await tx.insert(domainEvents).values([
    {
      kind: "offer.accepted",
      entity: "offer",
      entityId: offerId,
      payload: { offerId, requestId: offer.requestId, roundId: round.id },
    },
    {
      kind: "round.created",
      entity: "round",
      entityId: round.id,
      payload: { roundId: round.id, offerId, hostId: offer.hostId, requesterId, plusOneCount: plusOnes.length },
    },
  ]);

  return { roundId: round.id, threadId: thread.id };
}

/** Owner only. -> 'filled'. Idempotent. */
export async function fillRequest(tx: Tx, requesterId: string, requestId: string): Promise<void> {
  const [request] = await tx.select().from(requests).where(eq(requests.id, requestId)).for("update");
  if (!request) {
    throw new OfferError("REQUEST_NOT_FOUND", `request ${requestId} does not exist`);
  }
  if (request.userId !== requesterId) {
    throw new OfferError("NOT_OWNER", `member ${requesterId} does not own request ${requestId}`);
  }
  if (request.state === "filled") {
    return;
  }

  await tx.update(requests).set({ state: "filled" }).where(eq(requests.id, requestId));

  await tx.insert(domainEvents).values({
    kind: "request.filled",
    entity: "request",
    entityId: requestId,
    payload: { requestId },
  });
}

async function getRoundParticipantRole(
  tx: Tx,
  roundId: string,
  userId: string,
): Promise<"host" | "guest" | null> {
  const participants = await tx.select().from(roundParticipants).where(eq(roundParticipants.roundId, roundId));
  const participant = participants.find((p) => p.userId === userId);
  return participant?.role ?? null;
}

export type ConfirmRoundResult =
  | { status: "confirmed"; bothConfirmed: boolean }
  | { status: "already_confirmed" };

/**
 * Either the host or the member guest (not a non-member plus-one, which
 * has no userId to authenticate as) can confirm their own side. When
 * both sides are set, settles the round in the same transaction.
 * Idempotent per side: a repeat call from a side that already confirmed
 * is a no-op, not a re-emit or a re-settle attempt.
 */
export async function confirmRound(tx: Tx, userId: string, roundId: string): Promise<ConfirmRoundResult> {
  const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).for("update");
  if (!round) {
    throw new OfferError("ROUND_NOT_FOUND", `round ${roundId} does not exist`);
  }
  if (round.cancelledAt) {
    throw new OfferError("ROUND_CANCELLED", `round ${roundId} is cancelled and cannot be confirmed`);
  }

  const role = round.hostId === userId ? "host" : await getRoundParticipantRole(tx, roundId, userId);
  if (role !== "host" && role !== "guest") {
    throw new OfferError("NOT_PARTICIPANT", `member ${userId} is not a participant on round ${roundId}`);
  }

  if (round.playedOn > todayIso()) {
    throw new OfferError("ROUND_IN_FUTURE", `round ${roundId} has not been played yet`);
  }

  const alreadyConfirmedThisSide =
    (role === "host" && round.hostConfirmedAt) || (role === "guest" && round.guestConfirmedAt);
  if (alreadyConfirmedThisSide) {
    return { status: "already_confirmed" };
  }

  const now = new Date();
  await tx
    .update(rounds)
    .set(role === "host" ? { hostConfirmedAt: now } : { guestConfirmedAt: now })
    .where(eq(rounds.id, roundId));

  await tx.insert(domainEvents).values({
    kind: "round.confirmed",
    entity: "round",
    entityId: roundId,
    payload: { roundId, userId, side: role },
  });

  const bothConfirmed = Boolean((role === "host" ? now : round.hostConfirmedAt) && (role === "guest" ? now : round.guestConfirmedAt));
  if (bothConfirmed) {
    await settleRound(tx, roundId);
  }

  return { status: "confirmed", bothConfirmed };
}

export type CancelRoundResult = { status: "cancelled" } | { status: "already_cancelled" };

/**
 * Either participant. A cancelled round is terminal per the decision
 * log — never re-confirmed, never re-settled; if the round happens
 * after all, it's a new round. Reverses if already settled; if not,
 * there is no ledger involvement at all.
 */
export async function cancelRound(
  tx: Tx,
  userId: string,
  roundId: string,
  reason: string,
): Promise<CancelRoundResult> {
  const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).for("update");
  if (!round) {
    throw new OfferError("ROUND_NOT_FOUND", `round ${roundId} does not exist`);
  }

  const role = round.hostId === userId ? "host" : await getRoundParticipantRole(tx, roundId, userId);
  if (role !== "host" && role !== "guest") {
    throw new OfferError("NOT_PARTICIPANT", `member ${userId} is not a participant on round ${roundId}`);
  }

  if (round.cancelledAt) {
    return { status: "already_cancelled" };
  }

  if (round.settledAt) {
    await reverseRound(tx, roundId, reason);
  }

  await tx.update(rounds).set({ cancelledAt: new Date(), cancelReason: reason }).where(eq(rounds.id, roundId));
  await tx.update(offers).set({ state: "cancelled" }).where(eq(offers.id, round.offerId));

  await tx.insert(domainEvents).values({
    kind: "round.cancelled",
    entity: "round",
    entityId: roundId,
    payload: { roundId, reason },
  });

  return { status: "cancelled" };
}
