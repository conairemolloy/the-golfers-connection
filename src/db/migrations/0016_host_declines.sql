CREATE TYPE "public"."host_decline_reason" AS ENUM('not_this_time', 'dates_dont_suit', 'club_too_busy', 'other');--> statement-breakpoint
CREATE TABLE "host_declines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"reason" "host_decline_reason" NOT NULL,
	"note" text,
	"suggested_date_from" date,
	"suggested_date_to" date,
	"suggested_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_declines_request_id_host_id_unique" UNIQUE("request_id","host_id")
);
--> statement-breakpoint
ALTER TABLE "host_declines" ADD CONSTRAINT "host_declines_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_declines" ADD CONSTRAINT "host_declines_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_declines" ADD CONSTRAINT "host_declines_suggested_member_id_profiles_id_fk" FOREIGN KEY ("suggested_member_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_declines_host_id_idx" ON "host_declines" USING btree ("host_id");--> statement-breakpoint

-- ============================================================
-- host_declines RLS
-- ============================================================

ALTER TABLE "host_declines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "host_declines" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "host_declines" TO authenticated;
--> statement-breakpoint
CREATE POLICY "host_declines_select_host_or_requester" ON "host_declines" FOR SELECT TO authenticated
  USING (
    host_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM requests r WHERE r.id = host_declines.request_id AND r.user_id = (select auth.uid()))
  );
--> statement-breakpoint
CREATE POLICY "host_declines_insert_own" ON "host_declines" FOR INSERT TO authenticated
  WITH CHECK (host_id = (select auth.uid()));