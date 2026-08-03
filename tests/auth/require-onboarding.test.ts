import { describe, expect, it } from "vitest";
import { AuthError, requireOnboarding } from "@/lib/auth";
import { fixtureCurrentMember } from "./harness";

describe("requireOnboarding", () => {
  it("throws NO_SESSION for no session", () => {
    try {
      requireOnboarding(null);
      expect.fail("expected requireOnboarding to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("NO_SESSION");
    }
  });

  it("passes for an applicant", () => {
    const current = fixtureCurrentMember("applicant");
    expect(requireOnboarding(current)).toBe(current);
  });

  it("passes for a member", () => {
    const current = fixtureCurrentMember("member");
    expect(requireOnboarding(current)).toBe(current);
  });

  it("throws NOT_ONBOARDING for a removed profile", () => {
    const current = fixtureCurrentMember("removed");
    try {
      requireOnboarding(current);
      expect.fail("expected requireOnboarding to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("NOT_ONBOARDING");
    }
  });

  it("throws NOT_ONBOARDING for a lapsed profile", () => {
    const current = fixtureCurrentMember("lapsed");
    expect(() => requireOnboarding(current)).toThrow(AuthError);
  });
});
