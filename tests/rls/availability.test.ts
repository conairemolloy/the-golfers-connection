// Group 11 — host_availability.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectDenied, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 11: host_availability", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;
  let clientUnconfirmed: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
    clientUnconfirmed = await signInAs(fixtures.ephemeral.unconfirmedEmail);
  });

  afterAll(async () => {
    // Any row A managed to insert is cleaned up in harness teardown
    // (userId is a FK teardown needs to clear before deleting A's profile
    // and club2), not here.
    await clientA.auth.signOut();
    await clientUnconfirmed.auth.signOut();
  });

  it("A can insert availability at A's confirmed club", async () => {
    const { error } = await clientA.from("host_availability").insert({
      user_id: fixtures.ephemeral.memberAId,
      club_id: fixtures.ephemeral.club2Id,
      weekday: 5,
      capacity: 2,
    });
    expect(error).toBeNull();
  });

  it("A cannot insert availability at a club A has no confirmed membership at", async () => {
    const { error } = await clientA.from("host_availability").insert({
      user_id: fixtures.ephemeral.memberAId,
      club_id: fixtures.fixed.club3Id,
      weekday: 5,
      capacity: 1,
    });
    expectDenied(error);
  });

  it("A cannot insert availability with user_id = B", async () => {
    const { error } = await clientA.from("host_availability").insert({
      user_id: fixtures.fixed.memberBId,
      club_id: fixtures.ephemeral.club2Id,
      weekday: 5,
      capacity: 1,
    });
    expectDenied(error);
  });

  it("A can see B's active availability", async () => {
    const { data, error } = await clientA
      .from("host_availability")
      .select("*")
      .eq("id", fixtures.fixed.availabilityBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A cannot UPDATE B's availability", async () => {
    const { data, error } = await clientA
      .from("host_availability")
      .update({ capacity: 99 })
      .eq("id", fixtures.fixed.availabilityBId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot DELETE B's availability", async () => {
    const { data, error } = await clientA
      .from("host_availability")
      .delete()
      .eq("id", fixtures.fixed.availabilityBId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("UNCONFIRMED cannot insert availability anywhere", async () => {
    const { error } = await clientUnconfirmed.from("host_availability").insert({
      user_id: fixtures.ephemeral.unconfirmedId,
      club_id: fixtures.ephemeral.club4Id,
      weekday: 5,
      capacity: 1,
    });
    expectDenied(error);
  });
});
