import { acceptOfferAction, confirmRoundAction } from "@/app/actions/offers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateRange } from "@/lib/format";

export interface IncomingOfferData {
  offerId: string;
  clubName: string;
  courseName: string;
  teeAtLocal: Date;
  message: string | null;
}

export function IncomingOfferCard({ offer }: { offer: IncomingOfferData }) {
  return (
    <Card className="flex flex-col gap-3">
      <p className="font-serif text-lg text-paper">{offer.clubName} — {offer.courseName}</p>
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone">
        {offer.teeAtLocal.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
      </p>
      {offer.message && <p className="font-sans text-sm text-paper/90">{offer.message}</p>}
      <form action={acceptOfferAction}>
        <input type="hidden" name="offerId" value={offer.offerId} />
        <Button type="submit">Accept offer</Button>
      </form>
    </Card>
  );
}

export interface RoundActionData {
  roundId: string;
  clubName: string;
  courseName: string;
  playedOn: string;
  hostConfirmedAt: Date | null;
  guestConfirmedAt: Date | null;
  canConfirm: boolean;
}

export function RoundActionCard({ round }: { round: RoundActionData }) {
  const bothConfirmed = Boolean(round.hostConfirmedAt && round.guestConfirmedAt);
  return (
    <Card className="flex flex-col gap-3">
      <p className="font-serif text-lg text-paper">{round.clubName} — {round.courseName}</p>
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone">{formatDateRange(round.playedOn, round.playedOn)}</p>
      <p className="font-sans text-sm text-stone">
        {bothConfirmed ? "Both players confirmed. The ledger has been settled." : "Awaiting both players’ confirmation."}
      </p>
      {round.canConfirm && (
        <form action={confirmRoundAction}>
          <input type="hidden" name="roundId" value={round.roundId} />
          <Button type="submit">Confirm round played</Button>
        </form>
      )}
    </Card>
  );
}
