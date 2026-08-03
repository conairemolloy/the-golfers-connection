// Session refresh, run before every route. Named proxy.ts, not
// middleware.ts: Next 16 deprecated and renamed the `middleware` file
// convention to `proxy` (see node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/proxy.md) — the request explicitly asked
// for src/middleware.ts, but that convention no longer exists in this
// Next version, and AGENTS.md says to check the docs rather than rely on
// prior knowledge here. Same exported-function-and-config shape either
// way, just a different filename and export name (`proxy`, not
// `middleware`).
//
// WHY THIS HAS TO RUN HERE, NOT PER-ROUTE. Supabase's access token is
// short-lived; @supabase/ssr refreshes it lazily on the first call to
// getUser()/getSession()/getClaims() in a request. Writing the refreshed
// token back to the browser means setting a cookie on the response — but
// per Next's own docs, "Setting cookies is not supported during Server
// Component rendering," only from a Server Action or Route Handler. A
// Server Component that calls getCurrentMember() deep in the tree has no
// response to write to. Proxy runs before rendering starts, on every
// matched request, and always has a response it can attach Set-Cookie
// headers to — so it's the one place a refresh is guaranteed to be
// persisted, regardless of which Server Component ends up needing the
// session. src/lib/supabase/server.ts's setAll swallows the "can't set
// cookies here" error during Server Component render on the assumption
// that this file already refreshed and persisted the session for the
// request.
//
// This only does the optimistic refresh + cookie sync, per Next's own
// authentication guide ("Optimistic checks with Proxy"): no database
// reads, no authorization decisions. Real authorization happens in
// src/lib/auth.ts's requireMember/requireOnboarding, called from each
// route/action — proxy is not the only line of defense.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror the writes onto the request too — cookies() reads inside
        // this same request further down the pipeline (Server Components,
        // route handlers) see them, not just the outgoing response.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not add logic between createServerClient and getUser() — anything
  // here risks running before the refreshed token lands on `response`,
  // which is exactly the bug this file exists to prevent.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except _next static/image assets and /api/health, per
    // the request — /api/health has no session to refresh and gets
    // polled often enough that skipping it isn't worth the noise.
    "/((?!_next/static|_next/image|favicon.ico|api/health).*)",
  ],
};
