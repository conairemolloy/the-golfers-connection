CREATE TYPE "public"."application_state" AS ENUM('draft', 'submitted', 'awaiting_endorsements', 'awaiting_club', 'with_committee', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."club_event_kind" AS ENUM('maintenance', 'closure', 'competition', 'news');--> statement-breakpoint
CREATE TYPE "public"."club_event_severity" AS ENUM('info', 'warning');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('none', 'informed', 'consented', 'declined');--> statement-breakpoint
CREATE TYPE "public"."endorsement_role" AS ENUM('proposer', 'seconder');--> statement-breakpoint
CREATE TYPE "public"."endorsement_state" AS ENUM('requested', 'given', 'refused');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."membership_verification_state" AS ENUM('declared', 'documented', 'club_confirmed');--> statement-breakpoint
CREATE TYPE "public"."offer_state" AS ENUM('offered', 'accepted', 'scheduled', 'played', 'confirmed', 'settled', 'withdrawn', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('applicant', 'member', 'lapsed', 'removed');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('open', 'filled', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."round_participant_role" AS ENUM('host', 'guest');--> statement-breakpoint
CREATE TYPE "public"."thread_kind" AS ENUM('round', 'trip', 'fixture');--> statement-breakpoint
CREATE TYPE "public"."verification_kind" AS ENUM('identity', 'club', 'handicap', 'cover');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"state" "application_state" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decline_reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_content" (
	"club_id" uuid PRIMARY KEY NOT NULL,
	"dress_on_course" text,
	"dress_clubhouse" text,
	"phones" text,
	"trolleys" text,
	"caddies" text,
	"caddie_fee_note" text,
	"after_golf" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"name" text NOT NULL,
	"holes" integer NOT NULL,
	"par" integer NOT NULL,
	"out_bearing" integer,
	"in_bearing" integer,
	CONSTRAINT "club_courses_out_bearing_check" CHECK ("club_courses"."out_bearing" is null or "club_courses"."out_bearing" between 0 and 359),
	CONSTRAINT "club_courses_in_bearing_check" CHECK ("club_courses"."in_bearing" is null or "club_courses"."in_bearing" between 0 and 359)
);
--> statement-breakpoint
CREATE TABLE "club_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"kind" "club_event_kind" NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date,
	"body" text NOT NULL,
	"severity" "club_event_severity" DEFAULT 'info' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"country" text NOT NULL,
	"tier" integer NOT NULL,
	"access_difficulty" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"timezone" text NOT NULL,
	"guest_fee_pence" integer,
	"consent_status" "consent_status" DEFAULT 'none' NOT NULL,
	"secretary_email" text,
	CONSTRAINT "clubs_tier_check" CHECK ("clubs"."tier" between 1 and 4),
	CONSTRAINT "clubs_access_difficulty_check" CHECK ("clubs"."access_difficulty" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "endorsements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"endorser_id" uuid NOT NULL,
	"role" "endorsement_role" NOT NULL,
	"state" "endorsement_state" DEFAULT 'requested' NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "endorsements_application_role_unique" UNIQUE("application_id","role")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"scope" text
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"would_again" boolean NOT NULL,
	"marks" text[] DEFAULT '{}'::text[] NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "feedback_round_from_user_unique" UNIQUE("round_id","from_user")
);
--> statement-breakpoint
CREATE TABLE "handicaps" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"index" numeric(4, 1) NOT NULL,
	"source" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_to_email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_by" uuid,
	"redeemed_at" timestamp with time zone,
	CONSTRAINT "invitations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_round_user_direction_unique" UNIQUE("round_id","user_id","direction")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"member_since" integer,
	"member_number" text,
	"verification_state" "membership_verification_state" DEFAULT 'declared' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"recheck_due" timestamp with time zone,
	CONSTRAINT "memberships_user_club_unique" UNIQUE("user_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"tee_at_local" timestamp NOT NULL,
	"tee_timezone" text NOT NULL,
	"state" "offer_state" DEFAULT 'offered' NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"initials" text NOT NULL,
	"discretion_mode" boolean DEFAULT false NOT NULL,
	"home_club_id" uuid,
	"status" "profile_status" DEFAULT 'applicant' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid,
	"from_user" uuid NOT NULL,
	"about_user" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_targets" (
	"request_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	CONSTRAINT "request_targets_request_id_club_id_pk" PRIMARY KEY("request_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"region" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"party_size" integer NOT NULL,
	"handicaps" text,
	"flexibility" text,
	"note" text,
	"state" "request_state" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_participants" (
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "round_participant_role" NOT NULL,
	CONSTRAINT "round_participants_round_id_user_id_pk" PRIMARY KEY("round_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"played_on" date NOT NULL,
	"host_id" uuid NOT NULL,
	"host_confirmed_at" timestamp with time zone,
	"guest_confirmed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "rounds_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "thread_members" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"last_read_at" timestamp with time zone,
	CONSTRAINT "thread_members_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "thread_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "verification_kind" NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_content" ADD CONSTRAINT "club_content_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_content" ADD CONSTRAINT "club_content_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_courses" ADD CONSTRAINT "club_courses_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_endorser_id_profiles_id_fk" FOREIGN KEY ("endorser_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_user_profiles_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_to_user_profiles_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handicaps" ADD CONSTRAINT "handicaps_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_issued_by_profiles_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_profiles_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_course_id_club_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."club_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_home_club_id_clubs_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_from_user_profiles_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_about_user_profiles_id_fk" FOREIGN KEY ("about_user") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_profiles_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_targets" ADD CONSTRAINT "request_targets_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_targets" ADD CONSTRAINT "request_targets_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_course_id_club_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."club_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_user_id_idx" ON "applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "applications_club_id_idx" ON "applications" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "applications_decided_by_idx" ON "applications" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "club_content_updated_by_idx" ON "club_content" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "club_courses_club_id_idx" ON "club_courses" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "club_events_club_id_idx" ON "club_events" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "endorsements_endorser_id_idx" ON "endorsements" USING btree ("endorser_id");--> statement-breakpoint
CREATE INDEX "feedback_from_user_idx" ON "feedback" USING btree ("from_user");--> statement-breakpoint
CREATE INDEX "feedback_to_user_idx" ON "feedback" USING btree ("to_user");--> statement-breakpoint
CREATE INDEX "invitations_issued_by_idx" ON "invitations" USING btree ("issued_by");--> statement-breakpoint
CREATE INDEX "invitations_redeemed_by_idx" ON "invitations" USING btree ("redeemed_by");--> statement-breakpoint
CREATE INDEX "ledger_entries_user_id_idx" ON "ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_club_id_idx" ON "memberships" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "messages_thread_id_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "offers_host_id_idx" ON "offers" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "offers_club_id_idx" ON "offers" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "offers_course_id_idx" ON "offers" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "offers_request_id_state_idx" ON "offers" USING btree ("request_id","state");--> statement-breakpoint
CREATE INDEX "profiles_home_club_id_idx" ON "profiles" USING btree ("home_club_id");--> statement-breakpoint
CREATE INDEX "reports_round_id_idx" ON "reports" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "reports_from_user_idx" ON "reports" USING btree ("from_user");--> statement-breakpoint
CREATE INDEX "reports_about_user_idx" ON "reports" USING btree ("about_user");--> statement-breakpoint
CREATE INDEX "reports_handled_by_idx" ON "reports" USING btree ("handled_by");--> statement-breakpoint
CREATE INDEX "request_targets_club_id_idx" ON "request_targets" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "requests_user_id_idx" ON "requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "requests_state_date_from_idx" ON "requests" USING btree ("state","date_from");--> statement-breakpoint
CREATE INDEX "round_participants_user_id_idx" ON "round_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rounds_course_id_idx" ON "rounds" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "rounds_host_id_idx" ON "rounds" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "thread_members_user_id_idx" ON "thread_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "threads_subject_id_idx" ON "threads" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "verifications_user_id_idx" ON "verifications" USING btree ("user_id");