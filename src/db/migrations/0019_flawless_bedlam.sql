ALTER TABLE "requests" ADD COLUMN "seed_key" text;--> statement-breakpoint
-- Backfill: existing seed rows carry their key as a trailing
-- `[[seed:<key>]]` marker in note (scripts/seed.ts, pre-seed_key). Lift it
-- into seed_key and strip it from the member-facing note.
UPDATE "requests"
SET "seed_key" = substring("note" from '\[\[seed:([^\]]+)\]\]$'),
    "note" = btrim(regexp_replace("note", '\s*\[\[seed:[^\]]+\]\]$', ''))
WHERE "note" ~ '\[\[seed:[^\]]+\]\]$';--> statement-breakpoint
CREATE UNIQUE INDEX "requests_seed_key_unique" ON "requests" USING btree ("seed_key") WHERE "requests"."seed_key" is not null;