import { describe, expect, it } from "vitest";
import { AuthError, requireMember } from "@/lib/auth";
import { fixtureCurrentMember } from "./harness";

describe("requireMember", () => {
  it("throws NO_SESSION for no session", () => {
    expect(() => requireMember(null)).toThrow(AuthError);
    try {
      requireMember(null);
      expect.fail("expected requireMember to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("NO_SESSION");
    }
  });

  it("throws NOT_MEMBER for an applicant", () => {
    const current = fixtureCurrentMember("applicant");
    try {
      requireMember(current);
      expect.fail("expected requireMember to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("NOT_MEMBER");
    }
  });

  it("passes for a member", () => {
    const current = fixtureCurrentMember("member");
    expect(requireMember(current)).toBe(current);
  });
});
