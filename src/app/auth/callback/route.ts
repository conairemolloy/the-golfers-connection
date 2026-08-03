import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { callbackRedirectPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const [profile] = await db.select({ status: profiles.status }).from(profiles).where(eq(profiles.id, data.user.id));
      const destination = callbackRedirectPath(profile?.status ?? null);

      const url = new URL(destination.path, origin);
      if (destination.error) url.searchParams.set("error", destination.error);
      return NextResponse.redirect(url);
    }
  }

  const failureUrl = new URL("/login", origin);
  failureUrl.searchParams.set("error", "auth_failed");
  return NextResponse.redirect(failureUrl);
}
