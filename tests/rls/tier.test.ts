// Group 5 — tier enforcement. This is where the tier rule lives:
// request_targets_insert_own_request_within_tier in 0007_rls_policies.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectDenied, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 5: tier enforcement", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;
  let clientUnconfirmed: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
    clientUnconfirmed = await signInAs(fixtures.ephemeral.unconfirmedEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
    await clientUnconfirmed.auth.signOut();
  });

  it("A (tier 2) can insert request_targets for the tier 2, 3 and 4 clubs on A's own request", async () => {
    for (const clubId of [
      fixtures.ephemeral.club2Id,
      fixtures.fixed.club3Id,
      fixtures.ephemeral.club4Id,
    ]) {
      const { error } = await clientA
        .from("request_targets")
        .insert({ request_id: fixtures.ephemeral.requestAId, club_id: clubId });
      expect(error, `inserting target club ${clubId}`).toBeNull();
    }
  });

  it("A cannot insert request_targets for the tier 1 club", async () => {
    const { error } = await clientA
      .from("request_targets")
      .insert({ request_id: fixtures.ephemeral.requestAId, club_id: fixtures.fixed.club1Id });
    expectDenied(error);
  });

  it("A cannot insert request_targets on B's request", async () => {
    const { error } = await clientA
      .from("request_targets")
      .insert({ request_id: fixtures.ephemeral.requestBId, club_id: fixtures.ephemeral.club2Id });
    expectDenied(error);
  });

  it("UNCONFIRMED (my_tier() NULL) cannot target ANY club — fail-closed", async () => {
    for (const clubId of [
      fixtures.ephemeral.club4Id, // UNCONFIRMED's own club, tier 4 — lowest bar, still denied
      fixtures.fixed.club1Id,
    ]) {
      const { error } = await clientUnconfirmed
        .from("request_targets")
        .insert({ request_id: fixtures.ephemeral.requestUnconfirmedId, club_id: clubId });
      expectDenied(error);
    }
  });
});
