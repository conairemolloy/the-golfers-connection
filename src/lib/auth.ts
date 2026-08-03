// Auth service. Server-only. Two things live here: the identity lookup
// every other service call needs an actor for (getCurrentMember and its
// dependents), and the magic-link send path (sendMagicLink).
//
// Testability note: resolveCurrentMember, requireMember, requireOnboarding
// and callbackRedirectPath are all plain functions over already-resolved
// inputs (a SupabaseClient, a CurrentMember | null, a profile status) —
// none of them touch next/headers directly. That's deliberate: cookies()
// only works inside a real Next.js request (RSC render, route handler,
// server action), which a vitest process never is. getCurrentMember is
// the one function that bridges to next/headers (via
// src/lib/supabase/server.ts), and it's a thin wrapper around
// resolveCurrentMember — tests exercise the logic through the
// next/headers-free functions directly, the same way tests/rls signs in
// with a plain supabase-js client rather than going through cookies.
import "server-only";
import { cache } from "react";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { standing, type Standing } from "@/lib/ledger";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

export type AuthErrorCode = "NO_SESSION" | "NOT_MEMBER" | "NOT_ONBOARDING" | "VALIDATION_FAILED" | "RATE_LIMITED" | "SEND_FAILED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export type ProfileStatus = (typeof schema.profileStatus.enumValues)[number];

export interface CurrentMember {
  userId: string;
  profile: typeof schema.profiles.$inferSelect;
  standing: Standing;
}

/**
 * A Supabase client's session-reading surface — narrowed so tests can pass
 * a plain signed-in supabase-js client (tests/auth/harness.ts's
 * signInAs, same pattern as tests/rls) without needing anything else off
 * the real client.
 */
export type SessionReader = Pick<SupabaseClient, "auth">;

/**
 * Resolves the caller's profile and standing from an already-constructed
 * Supabase client. No next/headers dependency, so it's directly testable.
 * Returns null for no session, and also for a session with no profile row
 * — the handle_new_user trigger (0006) means that shouldn't happen, but
 * failing closed rather than throwing is the safer default for a check
 * every route depends on.
 */
export async function resolveCurrentMember(supabase: SessionReader): Promise<CurrentMember | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(schema.profiles).where(eq(schema.profiles.id, user.id));
    if (!profile) return null;

    const memberStanding = await standing(tx, user.id);
    return { userId: user.id, profile, standing: memberStanding };
  });
}

/**
 * The real entry point for application code — every service call that
 * needs an actor goes through this. Cached for the lifetime of one
 * request/render pass with React's cache(), the same pattern as the
 * Next.js docs' DAL verifySession()/getUser() example, so a request that
 * touches five Server Components sharing one actor makes one query, not
 * five.
 */
export const getCurrentMember = cache(async (): Promise<CurrentMember | null> => {
  const supabase = await createServerSupabaseClient();
  return resolveCurrentMember(supabase);
});

/**
 * Takes the already-resolved result of getCurrentMember() rather than
 * calling it itself — keeps this synchronous and trivially testable
 * (pass a fixture CurrentMember, no DB or Supabase involved), and lets a
 * caller that already has `current` avoid a second lookup.
 */
export function requireMember(current: CurrentMember | null): CurrentMember {
  if (!current) {
    throw new AuthError("NO_SESSION", "no authenticated session");
  }
  if (current.profile.status !== "member") {
    throw new AuthError("NOT_MEMBER", `profile status is '${current.profile.status}', not 'member'`);
  }
  return current;
}

/** Same shape as requireMember, but the application flow also passes: status 'applicant' or 'member'. */
export function requireOnboarding(current: CurrentMember | null): CurrentMember {
  if (!current) {
    throw new AuthError("NO_SESSION", "no authenticated session");
  }
  if (current.profile.status !== "applicant" && current.profile.status !== "member") {
    throw new AuthError("NOT_ONBOARDING", `profile status is '${current.profile.status}', neither 'applicant' nor 'member'`);
  }
  return current;
}

/**
 * Where /auth/callback sends the browser after exchanging the code for a
 * session, keyed on the resulting profile's status. A pure function (no
 * Supabase, no cookies) so the routing decision is unit-testable without
 * exercising the actual route handler.
 */
export function callbackRedirectPath(status: ProfileStatus | null): { path: string; error?: string } {
  if (status === null) {
    return { path: "/login", error: "no_profile" };
  }
  switch (status) {
    case "applicant":
      return { path: "/apply" };
    case "member":
      return { path: "/" };
    case "lapsed":
      return { path: "/lapsed" };
    case "removed":
      return { path: "/login", error: "removed" };
  }
}

// --- magic link ------------------------------------------------------------

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const emailSchema = z.string().email();

export type SendMagicLinkResult = { status: "sent" } | { status: "rate_limited"; retryAfterSeconds: number };

/** The one piece of a Supabase client sendMagicLink actually calls — narrowed for the same test-injection reason as SessionReader. */
export type MagicLinkSender = { auth: Pick<SupabaseClient["auth"], "signInWithOtp"> };

/**
 * Unlike the request/offer/ledger services, this doesn't take a `tx:
 * Tx` — there's no other write to compose it with, and the rate-limit
 * row deliberately needs to survive even if the signInWithOtp call below
 * throws (see the comment at the insert), which a shared caller-owned
 * transaction would roll back.
 */
export async function sendMagicLink(email: string, redirectTo: string, supabase: MagicLinkSender): Promise<SendMagicLinkResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    throw new AuthError("VALIDATION_FAILED", parsed.error.message);
  }
  const normalizedEmail = parsed.data.toLowerCase();

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await db
    .select({ requestedAt: schema.magicLinkRequests.requestedAt })
    .from(schema.magicLinkRequests)
    .where(and(eq(schema.magicLinkRequests.email, normalizedEmail), gt(schema.magicLinkRequests.requestedAt, windowStart)))
    .orderBy(schema.magicLinkRequests.requestedAt);

  if (recent.length >= RATE_LIMIT_MAX) {
    const retryAfterMs = recent[0].requestedAt.getTime() + RATE_LIMIT_WINDOW_MS - Date.now();
    return { status: "rate_limited", retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  // Recorded before the send call, and outside any transaction the caller
  // might wrap this in: a magic-link send that fails Supabase-side still
  // consumed an attempt. That's the right call for an abuse deterrent —
  // and simpler than rolling the row back on failure, or losing it to a
  // caller's rollback if it were written inside a shared transaction.
  await db.insert(schema.magicLinkRequests).values({ email: normalizedEmail });

  const { error } = await supabase.auth.signInWithOtp({ email: normalizedEmail, options: { emailRedirectTo: redirectTo } });
  if (error) {
    throw new AuthError("SEND_FAILED", error.message);
  }

  return { status: "sent" };
}
