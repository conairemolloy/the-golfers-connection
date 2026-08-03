// Shared fixture builders and client factory for tests/auth. Keeps its
// own ensureAuthUser/signInAs/PASSWORD rather than tests/support/auth.ts's
// ensureProfile, for the same reason tests/rls does (see tests/support/
// auth.ts's file comment): this suite needs per-user status control
// (applicant/member/lapsed/removed) and a stable sign-in password shared
// with its own signInAs.
//
// Fixture emails live under @auth-fixture.invalid — the "-fixture.invalid"
// suffix matters, not just cosmetically: it's the exact pattern
// scripts/seed.ts's summary counts already exclude (FIXTURE_EMAIL_PATTERN,
// "%-fixture.invalid"), so these permanent fixtures never pollute a seed
// run's member count the way a differently-named domain would.
//
// Permanent, find-or-create, no teardown — same reasoning as tests/
// support/auth.ts's ensureProfile: nothing here touches the ledger, so
// there's no append-only constraint forcing permanence, but there's also
// nothing to gain from tearing down and recreating the same handful of
// rows every run.
import { eq } from "drizzle-orm";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import type { CurrentMember } from "@/lib/auth";
import { ANON_KEY, assertTestEnv, closeDb, db, SUPABASE_URL } from "../support/db";
import { findAuthUserIdByEmail, supaAdmin } from "../support/auth";

assertTestEnv("tests/auth", { anonKey: true });

export { closeDb, db, supaAdmin };

export const PASSWORD = "Auth-Test-Suite-Passw0rd-1!";
const EMAIL_DOMAIN = "auth-fixture.invalid";

export function supaAnon(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function signInAs(email: string): Promise<SupabaseClient> {
  const client = supaAnon();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    throw new Error(`sign-in failed for ${email}: ${error.message}`);
  }
  return client;
}

async function ensureAuthUser(admin: SupabaseClient, email: string): Promise<string> {
  const existingId = await findAuthUserIdByEmail(email);
  if (existingId) return existingId;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) {
    throw new Error(`createUser failed for ${email}: ${error?.message}`);
  }
  return data.user.id;
}

export type TestProfileStatus = (typeof schema.profileStatus.enumValues)[number];

export interface TestMember {
  id: string;
  email: string;
}

/**
 * Find-or-create a real auth user and reset their profile to `status`.
 * displayName/initials are only set for 'member' — profiles_member_needs_
 * name_check (0006) requires them there and nowhere else.
 */
export async function ensureMemberWithStatus(label: string, status: TestProfileStatus): Promise<TestMember> {
  const email = `${label}@${EMAIL_DOMAIN}`;
  const admin = supaAdmin();
  const userId = await ensureAuthUser(admin, email);

  const fields: Partial<typeof schema.profiles.$inferInsert> = { status };
  if (status === "member") {
    fields.displayName = `Auth Fixture — ${label}`;
    fields.initials = label.slice(0, 2).toUpperCase();
  }
  await db.update(schema.profiles).set(fields).where(eq(schema.profiles.id, userId));

  return { id: userId, email };
}

/**
 * A CurrentMember object built entirely in memory — no DB, no Supabase.
 * requireMember/requireOnboarding are pure functions over CurrentMember |
 * null, so their tests don't need a real signed-in session; they need a
 * plausible profile row shape.
 */
export function fixtureCurrentMember(status: TestProfileStatus): CurrentMember {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    profile: {
      id: "00000000-0000-0000-0000-000000000000",
      displayName: status === "member" ? "Fixture Member" : null,
      initials: status === "member" ? "FM" : null,
      discretionMode: false,
      homeClubId: null,
      status,
      isAdmin: false,
      pacePreference: "no_preference",
      joinedAt: new Date(),
      deletedAt: null,
    },
    standing: { balance: 0, state: "good", canRequest: true },
  };
}
