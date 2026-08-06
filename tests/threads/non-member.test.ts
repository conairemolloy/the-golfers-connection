// A member with no relation to a thread must be refused by every
// thread operation — read, send, mark read, mute.
import { afterAll, describe, expect, it } from "vitest";
import { markRead, muteThread, readThread, sendMessage, ThreadError } from "@/lib/threads";
import { buildAcceptedThread, closeDb, ensureThreadFixtures, runAndRollback } from "./harness";

describe("non-member access", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("cannot read the thread", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await expect(readThread(tx, fixtures.outsiderA, threadId)).rejects.toMatchObject({ code: "NOT_MEMBER" });
      await expect(readThread(tx, fixtures.outsiderA, threadId)).rejects.toBeInstanceOf(ThreadError);
    });
  });

  it("cannot send a message", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await expect(sendMessage(tx, fixtures.outsiderA, threadId, "hello")).rejects.toMatchObject({
        code: "NOT_MEMBER",
      });
    });
  });

  it("cannot mark the thread read", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await expect(markRead(tx, fixtures.outsiderA, threadId)).rejects.toMatchObject({ code: "NOT_MEMBER" });
    });
  });

  it("cannot mute the thread", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await expect(muteThread(tx, fixtures.outsiderA, threadId)).rejects.toMatchObject({ code: "NOT_MEMBER" });
    });
  });
});
