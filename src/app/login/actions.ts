"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { AuthError, sendMagicLink, type SendMagicLinkResult } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLinkAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const redirectTo = `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`;

  // redirect() throws internally, so the two calls to it below sit outside
  // this try/catch — inside it, they'd be caught by the generic `catch`
  // and re-thrown anyway, but keeping them out entirely is clearer than
  // relying on that.
  let result: SendMagicLinkResult;
  try {
    const supabase = await createClient();
    result = await sendMagicLink(email, redirectTo, supabase);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(`/login?error=${err.code.toLowerCase()}`);
    }
    throw err;
  }

  if (result.status === "rate_limited") {
    redirect(`/login?error=rate_limited&retryAfter=${result.retryAfterSeconds}`);
  }
  redirect("/login?sent=1");
}
