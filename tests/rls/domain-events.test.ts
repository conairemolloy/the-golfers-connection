// Group 12 — domain_events. Service role only, same shape as audit_log in
// service-only.test.ts (group 9) — no policies, no grants, deny-all.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixtures, loadFixtures, signInAs, supaAnon } from "./harness";

describe("group 12: domain_events", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
  });

  it("domain_events is unreachable by A", async () => {
    const { data, error } = await clientA.from("domain_events").select("*").limit(1);
    if (!error) {
      expect(data).toEqual([]);
    }
  });

  it("domain_events is unreachable by anon", async () => {
    const anon = supaAnon();
    const { data, error } = await anon.from("domain_events").select("*").limit(1);
    if (!error) {
      expect(data).toEqual([]);
    }
  });
});
