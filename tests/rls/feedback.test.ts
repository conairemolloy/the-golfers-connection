// Group 3 — blind release.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectDenied, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 3: blind release", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
  });

  it("unreleased feedback about A is invisible to A", async () => {
    const { data, error } = await clientA
      .from("feedback")
      .select("*")
      .eq("id", fixtures.ephemeral.feedbackUnreleasedAboutAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("released feedback about A is visible to A", async () => {
    const { data, error } = await clientA
      .from("feedback")
      .select("*")
      .eq("id", fixtures.ephemeral.feedbackReleasedAboutAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("feedback A wrote is visible to A", async () => {
    const { data, error } = await clientA
      .from("feedback")
      .select("*")
      .eq("id", fixtures.ephemeral.feedbackByAAboutBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A cannot UPDATE any feedback row", async () => {
    const { error } = await clientA
      .from("feedback")
      .update({ would_again: false })
      .eq("id", fixtures.ephemeral.feedbackByAAboutBId);
    expectDenied(error);
  });

  it("A cannot INSERT feedback for a round A did not play in", async () => {
    const { error } = await clientA.from("feedback").insert({
      round_id: fixtures.fixed.roundId,
      from_user: fixtures.ephemeral.memberAId,
      to_user: fixtures.fixed.memberBId,
      would_again: true,
    });
    expectDenied(error);
  });
});
