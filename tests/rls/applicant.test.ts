// Group 6 — applicant scope. Applicants get the onboarding-only surface:
// clubs and club_courses (private.is_onboarding()), nothing a member sees.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 6: applicant scope", () => {
  let fixtures: Fixtures;
  let clientApplicant: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientApplicant = await signInAs(fixtures.ephemeral.applicantEmail);
  });

  afterAll(async () => {
    await clientApplicant.auth.signOut();
  });

  it("APPLICANT can select clubs", async () => {
    const { data, error } = await clientApplicant.from("clubs").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("APPLICANT can select club_courses", async () => {
    const { data, error } = await clientApplicant.from("club_courses").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("APPLICANT cannot select requests", async () => {
    const { data, error } = await clientApplicant.from("requests").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("APPLICANT cannot select profiles other than their own", async () => {
    const { data, error } = await clientApplicant
      .from("profiles")
      .select("*")
      .eq("id", fixtures.fixed.memberBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("APPLICANT can select their own profile row", async () => {
    const { data, error } = await clientApplicant
      .from("profiles")
      .select("*")
      .eq("id", fixtures.ephemeral.applicantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("APPLICANT cannot select club_content", async () => {
    const { data, error } = await clientApplicant.from("club_content").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("APPLICANT cannot select club_events", async () => {
    const { data, error } = await clientApplicant.from("club_events").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
