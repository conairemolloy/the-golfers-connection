// Server-side Supabase client — Server Components, Server Actions, Route
// Handlers. Per @supabase/ssr's Next.js recipe: cookies() is async in the
// App Router (Next 15+), and the store returned by cookies() only allows
// writes from a Server Action or Route Handler, never a Server Component
// render — so setAll below is wrapped in a try/catch. When it's silently
// swallowed there (rendering a Server Component), src/proxy.ts is what
// actually persists a refreshed session back to the browser; see its
// comment for why the refresh has to happen there.
//
// Always call this per request — never module-scope the client — per
// createServerClient's own docs.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component during render, where cookies()
          // can't write. Safe to ignore as long as src/proxy.ts is
          // refreshing the session on every request.
        }
      },
    },
  });
}
