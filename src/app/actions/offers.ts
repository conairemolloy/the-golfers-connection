"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clubs } from "@/db/schema";
import { getCurrentMember, requireMember } from "@/lib/auth";
import { acceptOffer, confirmRound, makeOffer, OfferError } from "@/lib/offers";
import type { OfferErrorCode } from "@/lib/offer-messages";

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

export async function acceptOfferAction(formData: FormData): Promise<void> {
  const member = requireMember(await getCurrentMember());
  const offerId = String(formData.get("offerId") ?? "");
  let errorCode: OfferErrorCode | null = null;

  if (!offerId) {
    errorCode = "VALIDATION_FAILED";
  } else {
    try {
      await db.transaction((tx) => acceptOffer(tx, member.userId, offerId));
    } catch (error) {
      if (!(error instanceof OfferError)) throw error;
      errorCode = error.code;
    }
  }

  if (errorCode) redirect(`/?offerError=${encodeURIComponent(errorCode)}`);
  revalidatePath("/");
  redirect("/?roundCreated=1");
}

export async function confirmRoundAction(formData: FormData): Promise<void> {
  const member = requireMember(await getCurrentMember());
  const roundId = String(formData.get("roundId") ?? "");
  let errorCode: OfferErrorCode | null = null;

  if (!roundId) {
    errorCode = "VALIDATION_FAILED";
  } else {
    try {
      await db.transaction((tx) => confirmRound(tx, member.userId, roundId));
    } catch (error) {
      if (!(error instanceof OfferError)) throw error;
      errorCode = error.code;
    }
  }

  if (errorCode) redirect(`/?offerError=${encodeURIComponent(errorCode)}`);
  revalidatePath("/");
  redirect("/?roundConfirmed=1");
}
