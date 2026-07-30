// Group 8 — rounds.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 8: rounds", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;
  let clientAdmin: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
    clientAdmin = await signInAs(fixtures.fixed.adminEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
    await clientAdmin.auth.signOut();
  });

  it("A cannot read the round A was not a participant in", async () => {
    const { data, error } = await clientA
      .from("rounds")
      .select("*")
      .eq("id", fixtures.fixed.roundId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot read round_participants rows for that round", async () => {
    const { data, error } = await clientA
      .from("round_participants")
      .select("*")
      .eq("round_id", fixtures.fixed.roundId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("ADMIN can read the round", async () => {
    const { data, error } = await clientAdmin
      .from("rounds")
      .select("*")
      .eq("id", fixtures.fixed.roundId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
