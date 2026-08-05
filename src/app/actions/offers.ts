"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clubs } from "@/db/schema";
import { getCurrentMember, requireMember } from "@/lib/auth";
import { makeOffer, OfferError, type OfferErrorCode } from "@/lib/offers";

/** Exported so page.tsx can map the ?offerError=<CODE> query param back to a message without trusting client-supplied text. */
export const OFFER_ERROR_MESSAGES: Record<OfferErrorCode, string> = {
  VALIDATION_FAILED: "That offer doesn't look complete — check the course, date and time and try again.",
  REQUEST_NOT_FOUND: "That request no longer exists.",
  REQUEST_NOT_OPEN: "That request isn't open for offers anymore.",
  OWN_REQUEST: "You can't offer to host your own request.",
  NO_CONFIRMED_MEMBERSHIP: "You don't have a confirmed membership at that club.",
  COURSE_CLUB_MISMATCH: "That course doesn't belong to the selected club.",
  CLUB_NOT_TARGETED: "That club isn't one this request is asking for.",
  DUPLICATE_LIVE_OFFER: "You already have an open offer on this request.",
  OFFER_NOT_FOUND: "That offer no longer exists.",
  NOT_HOST: "You're not the host of that offer.",
  NOT_OFFERED: "That offer isn't in a state that can be changed.",
  NOT_OWNER: "You don't own that request.",
  ROUND_NOT_FOUND: "That round no longer exists.",
  NOT_PARTICIPANT: "You're not a participant in that round.",
  ROUND_IN_FUTURE: "That round hasn't been played yet.",
  ROUND_CANCELLED: "That round was cancelled.",
  HAS_LIVE_OFFER: "You already have a live offer on this request.",
  SUGGESTED_MEMBER_NOT_FOUND: "That member couldn't be found.",
};

/**
 * The card's course <select> encodes both ids as "clubId:courseId" — the
 * only way to keep club and course in sync without client JS, since a
 * plain <select> can't drive a second control. teeTimezone is never
 * taken from the client: it's read from the chosen club's own row, and
 * makeOffer re-validates clubId/courseId/target/membership regardless.
 */
export async function makeOfferAction(formData: FormData): Promise<void> {
  const member = requireMember(await getCurrentMember());

  const requestId = String(formData.get("requestId") ?? "");
  const course = String(formData.get("course") ?? "");
  const [clubId, courseId] = course.split(":");
  const teeAtLocal = String(formData.get("teeAtLocal") ?? "");
  const messageRaw = formData.get("message");
  const message = typeof messageRaw === "string" && messageRaw.trim() ? messageRaw.trim() : undefined;

  let errorCode: OfferErrorCode | null = null;
  let outsideRequestedDates = false;

  if (!requestId || !clubId || !courseId || !teeAtLocal) {
    errorCode = "VALIDATION_FAILED";
  } else {
    try {
      const [club] = await db.select({ timezone: clubs.timezone }).from(clubs).where(eq(clubs.id, clubId));
      if (!club) {
        errorCode = "NO_CONFIRMED_MEMBERSHIP";
      } else {
        const result = await db.transaction((tx) =>
          makeOffer(tx, member.userId, requestId, {
            clubId,
            courseId,
            teeAtLocal,
            teeTimezone: club.timezone,
            message,
          }),
        );
        outsideRequestedDates = result.outsideRequestedDates;
      }
    } catch (err) {
      if (!(err instanceof OfferError)) {
        throw err;
      }
      errorCode = err.code;
    }
  }

  if (errorCode) {
    redirect(`/?offerError=${encodeURIComponent(errorCode)}`);
  }

  revalidatePath("/");
  redirect(`/?offerSent=1${outsideRequestedDates ? "&offerOutsideDates=1" : ""}`);
}
