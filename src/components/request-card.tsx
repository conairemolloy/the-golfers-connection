import { makeOfferAction } from "@/app/actions/offers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateRange } from "@/lib/format";

const TIER_NUMERALS = ["I", "II", "III", "IV"];

/**
 * Fully resolved — no raw ids, no club lookups. Assembly (discretion-safe
 * name, home club name, the viewer's-club tier) happens once in
 * src/app/page.tsx rather than making this component fetch anything
 * itself, the same reasoning as Masthead/MastheadView's split.
 */
export interface RequestCardData {
  requestId: string;
  requesterName: string;
  requesterHomeClubName: string | null;
  tier: number;
  note: string | null;
  dateFrom: string;
  dateTo: string;
  partySize: number;
  handicaps: string | null;
  offerCount: number;
  /**
   * Courses at the viewer's confirmed clubs that target this request, one
   * option per course, value "clubId:courseId". Absent (or empty) when
   * the viewer has no confirmed club that both targets this request and
   * has a course on file — page.tsx resolves this so the card never
   * renders a form that can only fail.
   */
  offerCourses?: SelectOption[];
}

/** One open request. A fixture card, not a social post — no avatar, no action yet. */
export function RequestCard({ data }: { data: RequestCardData }) {
  const metaParts = [formatDateRange(data.dateFrom, data.dateTo), `Party of ${data.partySize}`];
  if (data.handicaps) {
    metaParts.push(`Handicaps ${data.handicaps}`);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-lg text-paper">{data.requesterName}</p>
          {data.requesterHomeClubName && <p className="font-sans text-xs text-stone">{data.requesterHomeClubName}</p>}
        </div>
        <span className="shrink-0 rounded-hairline border border-gilt/50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-gilt">
          Tier {TIER_NUMERALS[data.tier - 1] ?? data.tier}
        </span>
      </div>

      {data.note && <p className="font-sans text-sm text-paper/90">{data.note}</p>}

      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone tabular-nums">{metaParts.join(" · ")}</p>

      {data.offerCount > 0 && (
        <p className="font-sans text-xs text-stone">{data.offerCount === 1 ? "1 offer" : `${data.offerCount} offers`}</p>
      )}

      {data.offerCourses && data.offerCourses.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center font-mono text-[11px] uppercase tracking-[0.1em] text-gilt">
            Offer to host
          </summary>
          <form action={makeOfferAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="requestId" value={data.requestId} />
            <Select label="Club & course" name="course" options={data.offerCourses} required />
            <Field label="Tee time" name="teeAtLocal" type="datetime-local" required />
            <Textarea label="Message (optional)" name="message" />
            <Button type="submit">Send offer</Button>
          </form>
        </details>
      )}
    </Card>
  );
}
