import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { listThreads, markRead, muteThread, sendMessage, unmuteThread } from "@/lib/threads";
import { buildAcceptedThread, closeDb, ensureThreadFixtures, runAndRollback } from "./harness";

async function unreadCountFor(
  threads: Awaited<ReturnType<typeof listThreads>>,
  threadId: string,
): Promise<number> {
  return threads.find((t) => t.threadId === threadId)!.unreadCount;
}

describe("read state", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("unread count moves with markRead, and never counts the reader's own messages", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });

      await sendMessage(tx, fixtures.hostA, threadId, "morning — still on for Saturday?");

      expect(await unreadCountFor(await listThreads(tx, fixtures.requesterA), threadId)).toBe(1);
      // The sender never sees his own message as unread.
      expect(await unreadCountFor(await listThreads(tx, fixtures.hostA), threadId)).toBe(0);

      await markRead(tx, fixtures.requesterA, threadId);

      expect(await unreadCountFor(await listThreads(tx, fixtures.requesterA), threadId)).toBe(0);

      await sendMessage(tx, fixtures.hostA, threadId, "bringing a trolley, that OK?");
      expect(await unreadCountFor(await listThreads(tx, fixtures.requesterA), threadId)).toBe(1);
    });
  });

  it("markRead is idempotent", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await sendMessage(tx, fixtures.hostA, threadId, "hello");

      await markRead(tx, fixtures.requesterA, threadId);
      await markRead(tx, fixtures.requesterA, threadId);

      expect(await unreadCountFor(await listThreads(tx, fixtures.requesterA), threadId)).toBe(0);
    });
  });

  it("mute and unmute are idempotent", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });

      await muteThread(tx, fixtures.requesterA, threadId);
      await muteThread(tx, fixtures.requesterA, threadId);
      let [membership] = await tx
        .select()
        .from(schema.threadMembers)
        .where(and(eq(schema.threadMembers.threadId, threadId), eq(schema.threadMembers.userId, fixtures.requesterA)));
      expect(membership.muted).toBe(true);

      await unmuteThread(tx, fixtures.requesterA, threadId);
      await unmuteThread(tx, fixtures.requesterA, threadId);
      [membership] = await tx
        .select()
        .from(schema.threadMembers)
        .where(and(eq(schema.threadMembers.threadId, threadId), eq(schema.threadMembers.userId, fixtures.requesterA)));
      expect(membership.muted).toBe(false);
    });
  });
});
