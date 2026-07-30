// Group 7 — profiles.
//
// A note on "cannot UPDATE" here versus other groups: profiles DOES grant
// UPDATE to authenticated (unlike ledger_entries/feedback/threads, which
// grant no UPDATE at all and so fail at the grant level with an explicit
// error). profiles_update_own's USING clause instead filters the target
// row out of the update entirely — PostgREST returns success with zero
// rows affected, not an error. So the assertion here is "zero rows
// affected", not "error present".
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectDenied, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 7: profiles", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
  });

  it("A can select their own row", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .select("*")
      .eq("id", fixtures.ephemeral.memberAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A can select other members' rows", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .select("*")
      .eq("id", fixtures.fixed.adminId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A cannot select APPLICANT's row (status is not 'member')", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .select("*")
      .eq("id", fixtures.ephemeral.applicantId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot UPDATE B's row", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .update({ discretion_mode: true })
      .eq("id", fixtures.fixed.memberBId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A can UPDATE their own row", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .update({ discretion_mode: true })
      .eq("id", fixtures.ephemeral.memberAId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A cannot INSERT a profile", async () => {
    const { error } = await clientA
      .from("profiles")
      .insert({ id: crypto.randomUUID(), status: "applicant" });
    expectDenied(error);
  });
});
