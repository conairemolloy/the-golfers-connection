import type { OfferErrorCode } from "@/lib/offers";

export type { OfferErrorCode };

/** Maps the ?offerError=<CODE> query param without trusting client-supplied text. */
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
