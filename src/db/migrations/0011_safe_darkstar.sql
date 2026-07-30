ALTER TABLE "round_participants" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "round_participants_round_id_invited_by_idx" ON "round_participants" USING btree ("round_id","invited_by");--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_invited_by_check" CHECK (("round_participants"."is_member" and "round_participants"."invited_by" is null)
        or (not "round_participants"."is_member" and "round_participants"."invited_by" is not null));