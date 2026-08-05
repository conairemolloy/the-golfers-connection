import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { OFFER_ERROR_MESSAGES } from "@/app/actions/offers";
import { AuthError, getCurrentMember, requireMember, type CurrentMember } from "@/lib/auth";
import type { OfferErrorCode } from "@/lib/offers";
import { listBook, type BookEntry } from "@/lib/requests";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { RequestCard, type RequestCardData } from "@/components/request-card";

const NON_MEMBER_COPY: Record<"applicant" | "lapsed" | "removed", { heading: string; body: string }> = {
  applicant: {
    heading: "Application in progress",
    body: "Your endorsements are being gathered. We’ll be in touch once a decision is made.",
  },
  lapsed: {
    heading: "Membership lapsed",
    body: "Your membership has lapsed. Get in touch to renew your standing in the network.",
  },
  removed: {
    heading: "Access unavailable",
    body: "This account no longer has access to the network.",
  },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { offerSent, offerOutsideDates, offerError } = await searchParams;
  const offerErrorMessage =
    typeof offerError === "string" && Object.hasOwn(OFFER_ERROR_MESSAGES, offerError)
      ? OFFER_ERROR_MESSAGES[offerError as OfferErrorCode]
      : null;
  const current = await getCurrentMember();

  if (!current) {
    return (
      <main className="flex flex-1 flex-col px-6">
        <EmptyState heading="The Golfers’ Connection" action={{ href: "/login", label: "Sign in" }}>
          A private reciprocal access network for members of elite clubs in Ireland and Britain.
        </EmptyState>
      </main>
    );
  }

  let member: CurrentMember;
  try {
    member = requireMember(current);
  } catch (err) {
    if (!(err instanceof AuthError)) {
      throw err;
    }
    const copy = NON_MEMBER_COPY[current.profile.status as keyof typeof NON_MEMBER_COPY] ?? NON_MEMBER_COPY.applicant;
    return (
      <main className="flex flex-1 flex-col px-6">
        <EmptyState heading={copy.heading}>{copy.body}</EmptyState>
      </main>
    );
  }

  const confirmedMemberships = await db
    .select({ clubId: schema.memberships.clubId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, member.userId), eq(schema.memberships.verificationState, "club_confirmed")));
  const confirmedClubIds = confirmedMemberships.map((m) => m.clubId);

  const entries: BookEntry[] =
    confirmedClubIds.length > 0 ? (await db.transaction((tx) => listBook(tx, member.userId, { limit: 20 }))).entries : [];

  const relevantClubIds = [
    ...new Set([
      ...confirmedClubIds,
      ...entries.flatMap((e) => e.targetClubIds),
      ...entries.map((e) => e.requesterHomeClubId).filter((id): id is string => id !== null),
    ]),
  ];
  const clubs =
    relevantClubIds.length > 0
      ? await db
          .select({ id: schema.clubs.id, name: schema.clubs.name, tier: schema.clubs.tier, timezone: schema.clubs.timezone })
          .from(schema.clubs)
          .where(inArray(schema.clubs.id, relevantClubIds))
      : [];
  const clubById = new Map(clubs.map((c) => [c.id, c]));

  // Courses at the viewer's own confirmed clubs — the only clubs he can
  // ever offer from — keyed by club so each request can filter to just
  // the clubs that target it.
  const courses =
    confirmedClubIds.length > 0
      ? await db
          .select({ id: schema.clubCourses.id, clubId: schema.clubCourses.clubId, name: schema.clubCourses.name })
          .from(schema.clubCourses)
          .where(inArray(schema.clubCourses.clubId, confirmedClubIds))
      : [];
  const coursesByClub = new Map<string, typeof courses>();
  for (const course of courses) {
    coursesByClub.set(course.clubId, [...(coursesByClub.get(course.clubId) ?? []), course]);
  }

  const cards: RequestCardData[] = entries.map((entry) => {
    // The club, among this request's targets, that put it in this
    // viewer's Book — the tier chip is relative to that club, not to
    // whichever of the request's several targets happens to sort first.
    const relevantTargetClubId = entry.targetClubIds.find((id) => confirmedClubIds.includes(id));

    // Every confirmed club of the viewer's that this request is asking
    // for, with a course on file — a club with no course would only
    // produce a form that can only fail, so it's left out entirely.
    const eligibleClubIds = entry.targetClubIds.filter((id) => confirmedClubIds.includes(id));
    const offerCourses = eligibleClubIds.flatMap((clubId) => {
      const club = clubById.get(clubId);
      if (!club) return [];
      return (coursesByClub.get(clubId) ?? []).map((course) => ({
        value: `${clubId}:${course.id}`,
        label: `${club.name} — ${course.name}`,
      }));
    });

    return {
      requestId: entry.requestId,
      requesterName: entry.requesterDisplayName ?? entry.requesterInitials ?? "",
      requesterHomeClubName: entry.requesterHomeClubId ? (clubById.get(entry.requesterHomeClubId)?.name ?? null) : null,
      tier: (relevantTargetClubId ? clubById.get(relevantTargetClubId)?.tier : undefined) ?? 1,
      note: entry.note,
      dateFrom: entry.dateFrom,
      dateTo: entry.dateTo,
      partySize: entry.partySize,
      handicaps: entry.handicaps,
      offerCount: entry.offerCount,
      offerCourses: offerCourses.length > 0 ? offerCourses : undefined,
    };
  });

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex flex-col gap-2">
        <Eyebrow>Open requests</Eyebrow>
        <h1 className="font-serif text-3xl text-bright">The Book</h1>
        <p className="max-w-prose font-sans text-sm text-stone">
          Requests from members travelling. Offer a game where you can — the ledger remembers.
        </p>
      </div>

      {typeof offerSent === "string" && (
        <p className="font-sans text-sm text-bright">
          Offer sent.
          {offerOutsideDates === "1" && " Note: your tee time falls outside the requested dates."}
        </p>
      )}
      {offerErrorMessage && <p className="font-sans text-sm text-debit">{offerErrorMessage}</p>}

      {confirmedClubIds.length === 0 ? (
        <EmptyState heading="Confirmation in progress">
          Your club membership is still being confirmed. The Book will show requests once that&rsquo;s done.
        </EmptyState>
      ) : cards.length === 0 ? (
        <EmptyState heading="The Book is quiet">Requests targeting your clubs will appear here.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((data) => (
            <RequestCard key={data.requestId} data={data} />
          ))}
        </div>
      )}
    </main>
  );
}
