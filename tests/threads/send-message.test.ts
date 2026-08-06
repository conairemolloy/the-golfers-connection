import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { readThread, sendMessage } from "@/lib/threads";
import { buildAcceptedThread, closeDb, ensureThreadFixtures, runAndRollback } from "./harness";

describe("sendMessage", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("rejects an empty body", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await expect(sendMessage(tx, fixtures.hostA, threadId, "")).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });
  });

  it("rejects a whitespace-only body", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      await expect(sendMessage(tx, fixtures.hostA, threadId, "   \n\t  ")).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });
  });

  it("accepts a real body, emits message.sent, and is readable by a member", async () => {
    const fixtures = await ensureThreadFixtures();
    await runAndRollback(async (tx) => {
      const { threadId } = await buildAcceptedThread(tx, { requesterId: fixtures.requesterA, hostId: fixtures.hostA });
      const { messageId } = await sendMessage(tx, fixtures.hostA, threadId, "looking forward to it");

      const events = await tx
        .select()
        .from(schema.domainEvents)
        .where(and(eq(schema.domainEvents.kind, "message.sent"), eq(schema.domainEvents.entityId, messageId)));
      expect(events).toHaveLength(1);

      const thread = await readThread(tx, fixtures.requesterA, threadId);
      const message = thread.find((m) => m.messageId === messageId);
      expect(message).toBeTruthy();
      expect(message!.body).toBe("looking forward to it");
      expect(message!.senderId).toBe(fixtures.hostA);
    });
  });
});
