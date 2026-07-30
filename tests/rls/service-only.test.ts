// Group 9 — service-only tables.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixtures, loadFixtures, signInAs, supaAnon } from "./harness";

describe("group 9: service-only tables", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
  });

  it("audit_log is unreachable by A", async () => {
    const { data, error } = await clientA.from("audit_log").select("*").limit(1);
    if (!error) {
      expect(data).toEqual([]);
    }
  });

  it("audit_log is unreachable by anon", async () => {
    const anon = supaAnon();
    const { data, error } = await anon.from("audit_log").select("*").limit(1);
    if (!error) {
      expect(data).toEqual([]);
    }
  });

  // domain_events does not exist yet (see 0007_rls_policies.sql: "domain_events
  // does not exist yet — no table to secure"). Add its policy — also
  // none-for-authenticated, service role only — in the migration that
  // creates it, then un-skip this.
  it.skip("domain_events is unreachable by A and by anon", () => {});
});
