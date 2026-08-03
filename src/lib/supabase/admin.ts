// Service-role Supabase client — bypasses RLS entirely (see CLAUDE.md's
// THREAT MODEL note in 0007_rls_policies.sql). Used for auth admin
// operations (creating/inviting users) that the anon/authenticated roles
// can never do. Server-only, always: SUPABASE_SERVICE_ROLE_KEY must never
// reach a browser bundle. `server-only` throws at build time if this
// module ends up in a client bundle — a stronger guard than a runtime
// `typeof window` check, which only fires the first time the code
// actually executes in a browser.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function createAdminClient() {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
