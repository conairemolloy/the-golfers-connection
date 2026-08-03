// Split in two for testability, the same move as auth.ts's requireMember/
// requireOnboarding: Masthead is the real Server Component, reading the
// actor via getCurrentMember() (and, only when signed in, the home
// club's name). MastheadView is the pure presentational half — no
// Supabase, no cookies(), no DB — so tests/auth/masthead.test.ts can
// render it directly against a fixture CurrentMember with
// renderToStaticMarkup rather than needing a real request context.
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { getCurrentMember, type CurrentMember } from "@/lib/auth";
import { Label } from "@/components/ui/label";

async function resolveHomeClubName(homeClubId: string | null): Promise<string | null> {
  if (!homeClubId) return null;
  const [club] = await db.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, homeClubId));
  return club?.name ?? null;
}

export async function Masthead() {
  const current = await getCurrentMember();
  // Signed out, no query runs at all — not even a home-club lookup.
  const homeClubName = current ? await resolveHomeClubName(current.profile.homeClubId) : null;
  return <MastheadView current={current} homeClubName={homeClubName} />;
}

export function MastheadView({ current, homeClubName }: { current: CurrentMember | null; homeClubName: string | null }) {
  const isMember = current?.profile.status === "member";
  const identity = current ? (current.profile.displayName ?? current.profile.initials) : null;

  return (
    <header className="flex items-start justify-between gap-4 border-b border-stone/20 px-6 py-5">
      <Link href="/" className="leading-none">
        <span className="block font-serif text-xl text-bright">The Golfers&rsquo;</span>
        <span className="block font-serif text-lg italic text-paper/80">Connection</span>
      </Link>
      {current && (
        <div className="flex flex-col items-end gap-1 text-right">
          {identity && <span className="font-sans text-sm text-paper">{identity}</span>}
          {!isMember && !identity && <span className="font-sans text-sm text-stone">Application in progress</span>}
          {homeClubName && <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-stone">{homeClubName}</span>}
          <Label className={isMember ? "text-credit" : undefined}>{isMember ? "Verified" : "Applicant"}</Label>
        </div>
      )}
    </header>
  );
}
