import { and, eq, gte, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { excludeFixtureClubs } from "@/lib/clubs";
import { OFFER_ERROR_MESSAGES, type OfferErrorCode } from "@/lib/offer-messages";
import { AuthError, getCurrentMember, requireMember, type CurrentMember } from "@/lib/auth";
import { listBook, type BookEntry } from "@/lib/requests";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { RequestCard, type RequestCardData } from "@/components/request-card";
import { RequestForm } from "@/components/request-form";
import { IncomingOfferCard, RoundActionCard, type IncomingOfferData, type RoundActionData } from "@/components/round-actions";

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
  const { offerSent, offerOutsideDates, offerError, requestCreated, requestError, roundCreated, roundConfirmed } = await searchParams;
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
  const memberTier = Math.min(...confirmedClubIds.map((id) => clubById.get(id)?.tier ?? Number.POSITIVE_INFINITY));
  const targetClubs =
    Number.isFinite(memberTier)
      ? await db
          .select({ id: schema.clubs.id, name: schema.clubs.name, tier: schema.clubs.tier })
          .from(schema.clubs)
          .where(and(gte(schema.clubs.tier, memberTier), excludeFixtureClubs()))
          .orderBy(schema.clubs.tier, schema.clubs.name)
      : [];

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

  const incomingOffers: IncomingOfferData[] = await db
    .select({
      offerId: schema.offers.id,
      clubName: schema.clubs.name,
      courseName: schema.clubCourses.name,
      teeAtLocal: schema.offers.teeAtLocal,
      message: schema.offers.message,
    })
    .from(schema.offers)
    .innerJoin(schema.requests, eq(schema.offers.requestId, schema.requests.id))
    .innerJoin(schema.clubs, eq(schema.offers.clubId, schema.clubs.id))
    .innerJoin(schema.clubCourses, eq(schema.offers.courseId, schema.clubCourses.id))
    .where(and(eq(schema.requests.userId, member.userId), eq(schema.offers.state, "offered")));

  const currentRounds = await db
    .select({
      roundId: schema.rounds.id,
      clubName: schema.clubs.name,
      courseName: schema.clubCourses.name,
      playedOn: schema.rounds.playedOn,
      hostConfirmedAt: schema.rounds.hostConfirmedAt,
      guestConfirmedAt: schema.rounds.guestConfirmedAt,
      hostId: schema.rounds.hostId,
      cancelledAt: schema.rounds.cancelledAt,
    })
    .from(schema.rounds)
    .innerJoin(schema.offers, eq(schema.rounds.offerId, schema.offers.id))
    .innerJoin(schema.requests, eq(schema.offers.requestId, schema.requests.id))
    .innerJoin(schema.clubs, eq(schema.offers.clubId, schema.clubs.id))
    .innerJoin(schema.clubCourses, eq(schema.offers.courseId, schema.clubCourses.id))
    .where(or(eq(schema.rounds.hostId, member.userId), eq(schema.requests.userId, member.userId)));
  const today = new Date().toISOString().slice(0, 10);
  const roundCards: RoundActionData[] = currentRounds.map((round) => ({
    ...round,
    canConfirm:
      !round.cancelledAt &&
      round.playedOn <= today &&
      (round.hostId === member.userId ? !round.hostConfirmedAt : !round.guestConfirmedAt),
  }));

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
      {typeof requestCreated === "string" && <p className="font-sans text-sm text-bright">Request opened.</p>}
      {typeof requestError === "string" && <p className="font-sans text-sm text-debit">That request could not be opened. Check the dates and clubs, then try again.</p>}
      {typeof roundCreated === "string" && <p className="font-sans text-sm text-bright">Offer accepted. Your round is ready.</p>}
      {typeof roundConfirmed === "string" && <p className="font-sans text-sm text-bright">Round confirmed.</p>}

      {incomingOffers.length > 0 && (
        <section className="flex flex-col gap-4">
          <Eyebrow>Offers for you</Eyebrow>
          {incomingOffers.map((offer) => <IncomingOfferCard key={offer.offerId} offer={offer} />)}
        </section>
      )}

      {roundCards.length > 0 && (
        <section className="flex flex-col gap-4">
          <Eyebrow>Your rounds</Eyebrow>
          {roundCards.map((round) => <RoundActionCard key={round.roundId} round={round} />)}
        </section>
      )}

      {confirmedClubIds.length === 0 ? (
        <EmptyState heading="Confirmation in progress">
          Your club membership is still being confirmed. The Book will show requests once that&rsquo;s done.
        </EmptyState>
      ) : cards.length === 0 ? (
        <>
          <RequestForm targetClubs={targetClubs.map((club) => ({ value: club.id, label: `${club.name} · Tier ${club.tier}` }))} />
          <EmptyState heading="The Book is quiet">Requests targeting your clubs will appear here.</EmptyState>
        </>
      ) : (
        <>
          <RequestForm targetClubs={targetClubs.map((club) => ({ value: club.id, label: `${club.name} · Tier ${club.tier}` }))} />
          <div className="flex flex-col gap-4">
            {cards.map((data) => (
              <RequestCard key={data.requestId} data={data} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
