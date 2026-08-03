CREATE TABLE "magic_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "magic_link_requests_email_requested_at_idx" ON "magic_link_requests" USING btree ("email","requested_at");