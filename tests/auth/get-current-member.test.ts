import { afterAll, describe, expect, it } from "vitest";
import { resolveCurrentMember } from "@/lib/auth";
import { closeDb, ensureMemberWithStatus, signInAs, supaAnon } from "./harness";

afterAll(async () => {
  await closeDb();
});

describe("resolveCurrentMember", () => {
  it("returns null with no session", async () => {
    const result = await resolveCurrentMember(supaAnon());
    expect(result).toBeNull();
  });

  it("resolves the signed-in member's profile and standing", async () => {
    const member = await ensureMemberWithStatus("gcm-member", "member");
    const client = await signInAs(member.email);

    const result = await resolveCurrentMember(client);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe(member.id);
    expect(result?.profile.status).toBe("member");
    // No ledger entries for this fixture -> the default standing.
    expect(result?.standing).toEqual({ balance: 0, state: "good", canRequest: true });
  });
});
