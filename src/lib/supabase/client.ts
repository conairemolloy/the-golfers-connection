// Browser-side Supabase client. For use inside "use client" components
// only — anything server-side (Server Components, Route Handlers, Server
// Actions) uses src/lib/supabase/server.ts instead, which reads/writes
// the session via next/headers' cookies() rather than document.cookie.
import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
