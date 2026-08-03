import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { sendMagicLink, type MagicLinkSender } from "@/lib/auth";
import { closeDb, db } from "./harness";

// sendMagicLink writes through src/db/index.ts's own connection, not this
// suite's tests/support/db `db` — a different client, same underlying
// database, so cleanup via this `db` still sees and removes those rows.
const TEST_EMAIL = "rate-limit@auth-fixture.invalid";
const REDIRECT_TO = "https://example.test/auth/callback";

// A stub, not a real Supabase client — the point is testing our rate
// limit, not Supabase's OTP delivery, per the task brief.
const fakeSender: MagicLinkSender = {
  auth: {
    signInWithOtp: async () => ({ data: { user: null, session: null }, error: null }),
  },
};

async function clearRequests(): Promise<void> {
  await db.delete(schema.magicLinkRequests).where(eq(schema.magicLinkRequests.email, TEST_EMAIL));
}

beforeEach(clearRequests);
afterAll(async () => {
  await clearRequests();
  await closeDb();
});

describe("sendMagicLink rate limit", () => {
  it("allows three sends and blocks a fourth within the 15-minute window", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await sendMagicLink(TEST_EMAIL, REDIRECT_TO, fakeSender);
      expect(result.status).toBe("sent");
    }

    const fourth = await sendMagicLink(TEST_EMAIL, REDIRECT_TO, fakeSender);
    expect(fourth.status).toBe("rate_limited");
    if (fourth.status === "rate_limited") {
      expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("allows a send again once the earlier attempts are outside the window", async () => {
    const past = new Date(Date.now() - 16 * 60 * 1000);
    await db.insert(schema.magicLinkRequests).values([
      { email: TEST_EMAIL, requestedAt: past },
      { email: TEST_EMAIL, requestedAt: past },
      { email: TEST_EMAIL, requestedAt: past },
    ]);

    const result = await sendMagicLink(TEST_EMAIL, REDIRECT_TO, fakeSender);
    expect(result.status).toBe("sent");
  });
});
