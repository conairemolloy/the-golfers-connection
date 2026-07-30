CREATE TYPE "public"."pace_preference" AS ENUM('brisk', 'steady', 'no_preference');--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "host_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"course_id" uuid,
	"weekday" smallint,
	"date_from" date,
	"date_to" date,
	"capacity" integer DEFAULT 1 NOT NULL,
	"min_tier" integer,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "host_availability_capacity_check" CHECK ("host_availability"."capacity" > 0),
	CONSTRAINT "host_availability_min_tier_check" CHECK ("host_availability"."min_tier" is null or "host_availability"."min_tier" between 1 and 4),
	CONSTRAINT "host_availability_window_check" CHECK ("host_availability"."weekday" is not null or ("host_availability"."date_from" is not null and "host_availability"."date_to" is not null)),
	CONSTRAINT "host_availability_date_range_check" CHECK ("host_availability"."date_from" is null or "host_availability"."date_to" is null or "host_availability"."date_to" >= "host_availability"."date_from")
);
--> statement-breakpoint
ALTER TABLE "round_participants" DROP CONSTRAINT "round_participants_round_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "round_participants" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pace_preference" "pace_preference" DEFAULT 'no_preference' NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "pace_preference" "pace_preference";--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "is_member" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "snapshot_dress_on_course" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "snapshot_dress_clubhouse" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "snapshot_caddies" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "snapshot_caddie_fee_note" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "snapshot_guest_fee_pence" integer;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "snapshot_taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_availability" ADD CONSTRAINT "host_availability_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_availability" ADD CONSTRAINT "host_availability_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_availability" ADD CONSTRAINT "host_availability_course_id_club_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."club_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_events_processed_at_created_at_idx" ON "domain_events" USING btree ("processed_at","created_at");--> statement-breakpoint
CREATE INDEX "domain_events_entity_entity_id_idx" ON "domain_events" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "host_availability_club_id_active_idx" ON "host_availability" USING btree ("club_id","active");--> statement-breakpoint
CREATE INDEX "host_availability_user_id_idx" ON "host_availability" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_round_id_user_id_unique" ON "round_participants" USING btree ("round_id","user_id") WHERE "round_participants"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_membership_check" CHECK (("round_participants"."is_member" and "round_participants"."user_id" is not null and "round_participants"."guest_name" is null)
        or (not "round_participants"."is_member" and "round_participants"."user_id" is null and "round_participants"."guest_name" is not null));