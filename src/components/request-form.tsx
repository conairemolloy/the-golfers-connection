import { createRequestAction } from "@/app/actions/requests";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function RequestForm({ targetClubs }: { targetClubs: SelectOption[] }) {
  return (
    <details className="group border-y border-stone/30 py-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center font-mono text-[11px] uppercase tracking-[0.1em] text-gilt">
        Request a round
      </summary>
      <form action={createRequestAction} className="mt-4 flex max-w-prose flex-col gap-4">
        <Field label="Where are you travelling?" name="region" autoComplete="address-level1" required />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From" name="dateFrom" type="date" required />
          <Field label="To" name="dateTo" type="date" required />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Party size" name="partySize" type="number" min={1} max={8} defaultValue={1} required />
          <Field label="Handicaps (optional)" name="handicaps" placeholder="e.g. 8 and 14" />
        </div>
        <Select
          label="Pace of play"
          name="pacePreference"
          defaultValue="no_preference"
          options={[
            { value: "no_preference", label: "No preference" },
            { value: "brisk", label: "Brisk" },
            { value: "steady", label: "Steady" },
          ]}
        />
        <Textarea label="Flexibility (optional)" name="flexibility" placeholder="Other dates or times that would suit." />
        <Textarea label="A note for prospective hosts (optional)" name="note" />
        <fieldset className="flex flex-col gap-2">
          <legend className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone">Clubs you hope to play</legend>
          <p className="font-sans text-xs text-stone">Choose one or more clubs at your tier or below.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {targetClubs.map((club) => (
              <label key={club.value} className="flex min-h-11 items-center gap-3 border border-stone/30 px-3 font-sans text-sm text-paper">
                <input name="targetClubId" type="checkbox" value={club.value} />
                {club.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit">Open request</Button>
      </form>
    </details>
  );
}
