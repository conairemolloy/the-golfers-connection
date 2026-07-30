// Group 8 — rounds.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { closeDb, db, type Fixtures, loadFixtures, signInAs } from "./harness";

describe("group 8: rounds", () => {
  let fixtures: Fixtures;
  let clientA: SupabaseClient;
  let clientAdmin: SupabaseClient;
  let clientB: SupabaseClient;

  beforeAll(async () => {
    fixtures = loadFixtures();
    clientA = await signInAs(fixtures.ephemeral.memberAEmail);
    clientAdmin = await signInAs(fixtures.fixed.adminEmail);
    clientB = await signInAs(fixtures.fixed.memberBEmail);
  });

  afterAll(async () => {
    await clientA.auth.signOut();
    await clientAdmin.auth.signOut();
    await clientB.auth.signOut();
    await closeDb();
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

  // A plus-one (guest_name set, user_id null) on the fixed round. See
  // 0010_availability_domain_events_rls.sql: the SELECT policy gates on
  // private.is_round_participant(round_id)/is_admin(), never on this row's
  // own user_id, so nulling it for a plus-one doesn't change who can see
  // the row — visibility is "can you see this round", not "is this your row".
  it("a plus-one row is visible to a participant of that round", async () => {
    const { data, error } = await clientB
      .from("round_participants")
      .select("*")
      .eq("id", fixtures.fixed.plusOneParticipantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("a plus-one row is not visible to a non-participant", async () => {
    const { data, error } = await clientA
      .from("round_participants")
      .select("*")
      .eq("id", fixtures.fixed.plusOneParticipantId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // round_participants grants no INSERT to authenticated at all (rows are
  // written server-side), so the CHECK constraint can only be exercised
  // through the direct service connection, not through a client — this is
  // a database-invariant test, not an RLS test.
  it("the CHECK rejects a row with both user_id and guest_name", async () => {
    let caught: { cause?: { code?: string } } | undefined;
    try {
      await db.insert(schema.roundParticipants).values({
        roundId: fixtures.fixed.roundId,
        userId: fixtures.fixed.memberBId,
        guestName: "Should Not Be Allowed",
        isMember: true,
        role: "guest",
      });
    } catch (err) {
      caught = err as { cause?: { code?: string } };
    }
    expect(caught?.cause?.code).toBe("23514");
  });

  it("the CHECK rejects a row with neither user_id nor guest_name", async () => {
    let caught: { cause?: { code?: string } } | undefined;
    try {
      await db.insert(schema.roundParticipants).values({
        roundId: fixtures.fixed.roundId,
        userId: null,
        guestName: null,
        isMember: true,
        role: "guest",
      });
    } catch (err) {
      caught = err as { cause?: { code?: string } };
    }
    expect(caught?.cause?.code).toBe("23514");
  });
});
