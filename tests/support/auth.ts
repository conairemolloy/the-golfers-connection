// Shared supabase-admin and auth-user helpers for every test suite under
// tests/. tests/rls does NOT use ensureProfile: it needs per-user
// isAdmin/displayName/initials control and a stable sign-in password
// shared with its own signInAs, so it keeps its own ensureAuthUser/
// setMemberProfile in tests/rls/harness.ts and only shares supaAdmin and
// findAuthUserIdByEmail from here.

import { eq, sql } from "drizzle-orm";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { db, SERVICE_ROLE_KEY, SUPABASE_URL } from "./db";

export function supaAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(
    sql`select id from auth.users where email = ${email} limit 1`,
  );
  return rows[0]?.id ?? null;
}

// Never asserted on: no suite that uses ensureProfile ever signs in with
// it (only tests/rls signs in via supabase-js, and it has its own
// PASSWORD/ensureAuthUser). One fixed value is enough for every suite.
const DEFAULT_PASSWORD = "Test-Suite-Passw0rd-1!";

export interface EnsureProfileOptions {
  domain: string;
  markerPrefix: string;
  status?: "member" | "applicant";
  discretionMode?: boolean;
}

/**
 * Find-or-create an auth user for `label` under the caller's own email
 * domain, then reset their profile to a known baseline: status,
 * displayName (marker-prefixed, so fixture rows from different suites
 * can never collide or be mistaken for one another) and initials.
 * `discretionMode` is only written when the caller passes it — some
 * suites reset it every run, others never touch the column.
 */
export async function ensureProfile(label: string, opts: EnsureProfileOptions): Promise<string> {
  const email = `${label}@${opts.domain}`;
  const admin = supaAdmin();
  let userId = await findAuthUserIdByEmail(email);
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`createUser failed for ${email}: ${error?.message}`);
    }
    userId = data.user.id;
  }

  const fields: Partial<typeof schema.profiles.$inferInsert> = {
    status: opts.status ?? "member",
    displayName: `${opts.markerPrefix}${label}`,
    initials: label.slice(0, 2).toUpperCase(),
  };
  if (opts.discretionMode !== undefined) {
    fields.discretionMode = opts.discretionMode;
  }

  await db.update(schema.profiles).set(fields).where(eq(schema.profiles.id, userId));

  return userId;
}
