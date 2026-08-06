import { afterAll, describe, expect, it } from "vitest";
import { listThreads, readThread, sendMessage, SYSTEM_PROFILE_ID } from "@/lib/threads";
import { buildAcceptedThread, closeDb, ensureThreadFixtures, runAndRollback } from "./harness";

describe("auto-posted introduction", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("is the first message in a thread created by acceptOffer", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });

      const [first] = await readThread(tx, fixtures.hostA, threadId);
      expect(first).toBeTruthy();
      expect(first.senderId).toBe(SYSTEM_PROFILE_ID);
      expect(first.body.length).toBeGreaterThan(0);
    });
  });

  it("is authored by the system profile, not either participant", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });

      const messages = await readThread(tx, fixtures.hostA, threadId);
      expect(messages).toHaveLength(1);
      expect(messages[0].senderId).not.toBe(fixtures.hostA);
      expect(messages[0].senderId).not.toBe(fixtures.requesterA);
      expect(messages[0].senderId).toBe(SYSTEM_PROFILE_ID);
      expect(messages[0].senderName).toBe("The Golfers' Connection");
    });
  });

  it("does not count toward either member's unread count", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });

      // Neither side has read anything yet, but the introduction alone
      // must not show as unread — it reads as a note, not something
      // either member needs to act on.
      const hostThreads = await listThreads(tx, fixtures.hostA);
      const requesterThreads = await listThreads(tx, fixtures.requesterA);
      expect(hostThreads.find((t) => t.threadId === threadId)!.unreadCount).toBe(0);
      expect(requesterThreads.find((t) => t.threadId === threadId)!.unreadCount).toBe(0);

      // A real message from a participant still counts as normal.
      await sendMessage(tx, fixtures.hostA, threadId, "morning — still on for Saturday?");
      const requesterThreadsAfter = await listThreads(tx, fixtures.requesterA);
      expect(requesterThreadsAfter.find((t) => t.threadId === threadId)!.unreadCount).toBe(1);
    });
  });
});
