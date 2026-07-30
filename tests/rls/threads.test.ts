// Group 4 — threads.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectDenied, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 4: threads", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
  });

  it("A can read the thread A belongs to", async () => {
    const { data, error } = await clientA
      .from("threads")
      .select("*")
      .eq("id", fixtures.ephemeral.threadOwnedId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A can read messages in the thread A belongs to", async () => {
    const { data, error } = await clientA
      .from("messages")
      .select("*")
      .eq("thread_id", fixtures.ephemeral.threadOwnedId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("A cannot read the thread A does not belong to", async () => {
    const { data, error } = await clientA
      .from("threads")
      .select("*")
      .eq("id", fixtures.ephemeral.threadOtherId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot read messages in the thread A does not belong to", async () => {
    const { data, error } = await clientA
      .from("messages")
      .select("*")
      .eq("thread_id", fixtures.ephemeral.threadOtherId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("A cannot INSERT a message into the thread A is not in", async () => {
    const { error } = await clientA.from("messages").insert({
      thread_id: fixtures.ephemeral.threadOtherId,
      sender_id: fixtures.ephemeral.memberAId,
      body: "hostile insert attempt",
    });
    expectDenied(error);
  });

  it("A cannot INSERT into threads at all", async () => {
    const { error } = await clientA
      .from("threads")
      .insert({ kind: "round", subject_id: crypto.randomUUID() });
    expectDenied(error);
  });

  it("A cannot INSERT into thread_members to add themselves", async () => {
    const { error } = await clientA.from("thread_members").insert({
      thread_id: fixtures.ephemeral.threadOtherId,
      user_id: fixtures.ephemeral.memberAId,
    });
    expectDenied(error);
  });
});
