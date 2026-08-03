import { describe, expect, it } from "vitest";
import { callbackRedirectPath } from "@/lib/auth";

// The callback route (src/app/auth/callback/route.ts) is thin plumbing
// around this function: exchange the code, look up the resulting
// profile's status, ask callbackRedirectPath where to send the browser.
// Testing the decision here — a pure function — covers "the callback
// routes each status to the right destination" without needing to
// exercise Supabase's OTP exchange or a real Next.js request.
describe("callbackRedirectPath", () => {
  it("sends an applicant to /apply", () => {
    expect(callbackRedirectPath("applicant")).toEqual({ path: "/apply" });
  });

  it("sends a member to /", () => {
    expect(callbackRedirectPath("member")).toEqual({ path: "/" });
  });

  it("sends a lapsed member to /lapsed", () => {
    expect(callbackRedirectPath("lapsed")).toEqual({ path: "/lapsed" });
  });

  it("sends a removed profile to /login with an error", () => {
    expect(callbackRedirectPath("removed")).toEqual({ path: "/login", error: "removed" });
  });

  it("sends a missing profile to /login with an error", () => {
    expect(callbackRedirectPath(null)).toEqual({ path: "/login", error: "no_profile" });
  });
});
