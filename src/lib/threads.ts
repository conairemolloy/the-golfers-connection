// Thread service. Server-side only, same conventions as ledger.ts,
// requests.ts and offers.ts: every function takes a transaction handle
// so callers compose writes atomically, and every write goes through
// the `postgres` role, bypassing RLS entirely (see CLAUDE.md's THREAT
// MODEL note in 0007_rls_policies.sql).
import { and, count, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { clubCourses, clubs, domainEvents, messages, offers, profiles, rounds, threadMembers, threads } from "@/db/schema";
import type { Tx } from "@/lib/ledger";

export type { Tx };

// Reserved profile id for the auto-posted introduction (acceptOffer,
// src/lib/offers.ts) and any other system-authored message. Provisioned
// by migration 0020_system_profile.sql, which also creates the matching
// auth.users row profiles.id's FK requires. Never a real member — never
// a thread_members row, never shown in the directory, never a ledger
// entry.
export const SYSTEM_PROFILE_ID = "00000000-0000-0000-0000-000000000000";

export type ThreadErrorCode = "VALIDATION_FAILED" | "THREAD_NOT_FOUND" | "NOT_MEMBER";

export class ThreadError extends Error {
  readonly code: ThreadErrorCode;
  readonly details?: unknown;

  constructor(code: ThreadErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ThreadError";
    this.code = code;
    this.details = details;
  }
}

/** Throws THREAD_NOT_FOUND / NOT_MEMBER. Every function below calls this first. */
async function assertMember(tx: Tx, userId: string, threadId: string): Promise<void> {
  const [thread] = await tx.select({ id: threads.id }).from(threads).where(eq(threads.id, threadId));
  if (!thread) {
    throw new ThreadError("THREAD_NOT_FOUND", `thread ${threadId} does not exist`);
  }
  const [membership] = await tx
    .select({ userId: threadMembers.userId })
    .from(threadMembers)
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)));
  if (!membership) {
    throw new ThreadError("NOT_MEMBER", `member ${userId} is not a member of thread ${threadId}`);
  }
}

export interface ThreadListEntry {
  threadId: string;
  kind: (typeof schema.threadKind.enumValues)[number];
  otherParticipantName: string | null;
  clubName: string | null;
  teeAtLocal: Date | null;
  teeTimezone: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}

/**
 * Threads the member belongs to, newest activity first (last message, or
 * thread creation if it has none yet). Club/tee time are only populated
 * for kind 'round' — trip and fixture threads aren't built yet (M5
 * roadmap). otherParticipantName assumes exactly one other member, true
 * for every round thread today; a future trip thread with more than one
 * other member gets null rather than a guess at which name to show.
 */
export async function listThreads(tx: Tx, userId: string): Promise<ThreadListEntry[]> {
  const myMemberships = await tx.select().from(threadMembers).where(eq(threadMembers.userId, userId));
  if (myMemberships.length === 0) {
    return [];
  }
  const threadIds = myMemberships.map((m) => m.threadId);
  const lastReadByThread = new Map(myMemberships.map((m) => [m.threadId, m.lastReadAt]));

  const threadRows = await tx.select().from(threads).where(inArray(threads.id, threadIds));

  const otherMemberRows = await tx
    .select()
    .from(threadMembers)
    .where(and(inArray(threadMembers.threadId, threadIds), ne(threadMembers.userId, userId)));
  const otherUserIdsByThread = new Map<string, string[]>();
  for (const m of otherMemberRows) {
    const existing = otherUserIdsByThread.get(m.threadId);
    if (existing) {
      existing.push(m.userId);
    } else {
      otherUserIdsByThread.set(m.threadId, [m.userId]);
    }
  }
  const otherUserIds = [...new Set(otherMemberRows.map((m) => m.userId))];
  const otherProfiles =
    otherUserIds.length > 0 ? await tx.select().from(profiles).where(inArray(profiles.id, otherUserIds)) : [];
  const profileById = new Map(otherProfiles.map((p) => [p.id, p]));

  const roundThreads = threadRows.filter((t) => t.kind === "round");
  const roundIds = roundThreads.map((t) => t.subjectId);
  const roundRows = roundIds.length > 0 ? await tx.select().from(rounds).where(inArray(rounds.id, roundIds)) : [];
  const roundById = new Map(roundRows.map((r) => [r.id, r]));

  const courseIds = [...new Set(roundRows.map((r) => r.courseId))];
  const courseRows =
    courseIds.length > 0 ? await tx.select().from(clubCourses).where(inArray(clubCourses.id, courseIds)) : [];
  const courseById = new Map(courseRows.map((c) => [c.id, c]));

  const clubIds = [...new Set(courseRows.map((c) => c.clubId))];
  const clubRows = clubIds.length > 0 ? await tx.select().from(clubs).where(inArray(clubs.id, clubIds)) : [];
  const clubById = new Map(clubRows.map((c) => [c.id, c]));

  const offerIds = [...new Set(roundRows.map((r) => r.offerId))];
  const offerRows = offerIds.length > 0 ? await tx.select().from(offers).where(inArray(offers.id, offerIds)) : [];
  const offerById = new Map(offerRows.map((o) => [o.id, o]));

  // Last message per thread: ordered desc, so the first row seen per
  // threadId in iteration order is the latest.
  const orderedMessages = await tx
    .select()
    .from(messages)
    .where(inArray(messages.threadId, threadIds))
    .orderBy(desc(messages.createdAt));
  const lastMessageByThread = new Map<string, (typeof orderedMessages)[number]>();
  for (const m of orderedMessages) {
    if (!lastMessageByThread.has(m.threadId)) {
      lastMessageByThread.set(m.threadId, m);
    }
  }

  // Unread: messages not sent by the caller, newer than the caller's own
  // lastReadAt on that thread (or all of them, if never read). The
  // system profile's auto-posted introduction is excluded from both
  // queries below — it reads as a note, not a message either side needs
  // to act on, so it never inflates an unread badge.
  const unreadRows = await tx
    .select({ threadId: messages.threadId, unreadCount: count() })
    .from(messages)
    .innerJoin(threadMembers, and(eq(threadMembers.threadId, messages.threadId), eq(threadMembers.userId, userId)))
    .where(
      and(
        inArray(messages.threadId, threadIds),
        ne(messages.senderId, userId),
        ne(messages.senderId, SYSTEM_PROFILE_ID),
        // A per-row OR of two comparisons against that same row's own
        // lastReadAt — not `or()` of two WHERE-level conditions, since
        // lastReadAt varies per thread.
        gt(messages.createdAt, threadMembers.lastReadAt),
      ),
    )
    .groupBy(messages.threadId);
  // Threads never read (lastReadAt null) need every message counted —
  // `gt(x, null)` is unknown in SQL, not true, so those rows never make
  // the query above. Handled separately below.
  const neverReadThreadIds = threadIds.filter((id) => lastReadByThread.get(id) == null);
  const neverReadCounts =
    neverReadThreadIds.length > 0
      ? await tx
          .select({ threadId: messages.threadId, unreadCount: count() })
          .from(messages)
          .where(
            and(
              inArray(messages.threadId, neverReadThreadIds),
              ne(messages.senderId, userId),
              ne(messages.senderId, SYSTEM_PROFILE_ID),
            ),
          )
          .groupBy(messages.threadId)
      : [];
  const unreadByThread = new Map<string, number>();
  for (const r of unreadRows) {
    unreadByThread.set(r.threadId, Number(r.unreadCount));
  }
  for (const r of neverReadCounts) {
    unreadByThread.set(r.threadId, Number(r.unreadCount));
  }

  const entries: ThreadListEntry[] = threadRows.map((t) => {
    const otherIds = otherUserIdsByThread.get(t.id) ?? [];
    const otherParticipantName =
      otherIds.length === 1 ? (profileById.get(otherIds[0])?.displayName ?? null) : null;

    const round = t.kind === "round" ? roundById.get(t.subjectId) : undefined;
    const course = round ? courseById.get(round.courseId) : undefined;
    const club = course ? clubById.get(course.clubId) : undefined;
    const offer = round ? offerById.get(round.offerId) : undefined;

    const lastMessage = lastMessageByThread.get(t.id);

    return {
      threadId: t.id,
      kind: t.kind,
      otherParticipantName,
      clubName: club?.name ?? null,
      teeAtLocal: offer?.teeAtLocal ?? null,
      teeTimezone: offer?.teeTimezone ?? null,
      lastMessagePreview: lastMessage?.body ?? null,
      lastMessageAt: lastMessage?.createdAt ?? null,
      unreadCount: unreadByThread.get(t.id) ?? 0,
    };
  });

  entries.sort((a, b) => {
    const aTime = (a.lastMessageAt ?? threadRows.find((t) => t.id === a.threadId)!.createdAt).getTime();
    const bTime = (b.lastMessageAt ?? threadRows.find((t) => t.id === b.threadId)!.createdAt).getTime();
    return bTime - aTime;
  });

  return entries;
}

export interface ThreadMessageEntry {
  messageId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
}

/** Messages oldest first, with sender names. Refuses a non-member of the thread. */
export async function readThread(tx: Tx, userId: string, threadId: string): Promise<ThreadMessageEntry[]> {
  await assertMember(tx, userId, threadId);

  const rows = await tx.select().from(messages).where(eq(messages.threadId, threadId)).orderBy(messages.createdAt);

  const senderIds = [...new Set(rows.map((m) => m.senderId))];
  const senders = senderIds.length > 0 ? await tx.select().from(profiles).where(inArray(profiles.id, senderIds)) : [];
  const senderById = new Map(senders.map((p) => [p.id, p]));

  return rows.map((m) => ({
    messageId: m.id,
    senderId: m.senderId,
    senderName: senderById.get(m.senderId)?.displayName ?? null,
    body: m.body,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
  }));
}

/** Refuses a non-member, refuses an empty body. Emits message.sent. */
export async function sendMessage(
  tx: Tx,
  userId: string,
  threadId: string,
  body: string,
): Promise<{ messageId: string }> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new ThreadError("VALIDATION_FAILED", "message body cannot be empty");
  }

  await assertMember(tx, userId, threadId);

  // clock_timestamp(), not the schema default's now() — now() is fixed
  // for the lifetime of the transaction, so two messages (or a message
  // and a markRead) in the same transaction would otherwise collide on
  // one identical timestamp and break unread ordering. clock_timestamp()
  // still advances mid-transaction, same reasoning as markRead below.
  const [message] = await tx
    .insert(messages)
    .values({ threadId, senderId: userId, body: trimmed, createdAt: sql`clock_timestamp()` })
    .returning();

  await tx.insert(domainEvents).values({
    kind: "message.sent",
    entity: "message",
    entityId: message.id,
    payload: { messageId: message.id, threadId, senderId: userId },
  });

  return { messageId: message.id };
}

/**
 * The auto-posted introduction (acceptOffer, src/lib/offers.ts) or any
 * other system-authored message. Unlike sendMessage, skips assertMember
 * — the system profile is never added to thread_members, so it would
 * otherwise fail NOT_MEMBER — and skips the empty-body check, since
 * callers here build the body themselves rather than taking it from a
 * user. Still emits message.sent, same as a real message.
 */
export async function postSystemMessage(tx: Tx, threadId: string, body: string): Promise<{ messageId: string }> {
  const [message] = await tx
    .insert(messages)
    .values({ threadId, senderId: SYSTEM_PROFILE_ID, body, createdAt: sql`clock_timestamp()` })
    .returning();

  await tx.insert(domainEvents).values({
    kind: "message.sent",
    entity: "message",
    entityId: message.id,
    payload: { messageId: message.id, threadId, senderId: SYSTEM_PROFILE_ID },
  });

  return { messageId: message.id };
}

/**
 * Updates the caller's own thread_members.lastReadAt. Idempotent.
 *
 * clock_timestamp(), not a JS `new Date()` — keeps this comparable
 * against messages.createdAt (also clock_timestamp(), see sendMessage)
 * from the same clock, rather than risking skew between the app
 * server's clock and the database's.
 */
export async function markRead(tx: Tx, userId: string, threadId: string): Promise<void> {
  await assertMember(tx, userId, threadId);
  await tx
    .update(threadMembers)
    .set({ lastReadAt: sql`clock_timestamp()` })
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)));
}

/** Mutes the thread for the caller only. Idempotent. */
export async function muteThread(tx: Tx, userId: string, threadId: string): Promise<void> {
  await assertMember(tx, userId, threadId);
  await tx
    .update(threadMembers)
    .set({ muted: true })
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)));
}

/** Unmutes the thread for the caller only. Idempotent. */
export async function unmuteThread(tx: Tx, userId: string, threadId: string): Promise<void> {
  await assertMember(tx, userId, threadId);
  await tx
    .update(threadMembers)
    .set({ muted: false })
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)));
}
