// Group 2 — ledger isolation.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectDenied, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 2: ledger isolation", () => {
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

  it("A selecting ledger_entries returns only A's rows (zero here)", async () => {
    const { data, error } = await clientA.from("ledger_entries").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot see B's entries by any filter", async () => {
    const { data, error } = await clientA
      .from("ledger_entries")
      .select("*")
      .eq("user_id", fixtures.fixed.memberBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A calling member_balance(B) raises", async () => {
    const { error } = await clientA.rpc("member_balance", {
      p_user_id: fixtures.fixed.memberBId,
    });
    expectDenied(error);
  });

  it("A calling member_balance(A) succeeds", async () => {
    const { data, error } = await clientA.rpc("member_balance", {
      p_user_id: fixtures.ephemeral.memberAId,
    });
    expect(error).toBeNull();
    expect(data).toBe(0);
  });

  it("ADMIN calling member_balance(B) succeeds", async () => {
    const { data, error } = await clientAdmin.rpc("member_balance", {
      p_user_id: fixtures.fixed.memberBId,
    });
    expect(error).toBeNull();
    expect(typeof data).toBe("number");
  });

  it("A cannot INSERT into ledger_entries", async () => {
    const { error } = await clientA.from("ledger_entries").insert({
      user_id: fixtures.ephemeral.memberAId,
      round_id: fixtures.fixed.roundId,
      direction: "credit",
      amount: 10,
      reason: "hostile insert attempt",
      idempotency_key: `hostile-${crypto.randomUUID()}`,
    });
    expectDenied(error);
  });

  it("A cannot UPDATE a ledger entry", async () => {
    const { error } = await clientA
      .from("ledger_entries")
      .update({ amount: 1 })
      .eq("user_id", fixtures.fixed.memberBId);
    expectDenied(error);
  });

  it("A cannot DELETE a ledger entry", async () => {
    const { error } = await clientA
      .from("ledger_entries")
      .delete()
      .eq("user_id", fixtures.fixed.memberBId);
    expectDenied(error);
  });
});
