ALTER TABLE "rounds" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_request_id_host_id_live_unique" ON "offers" USING btree ("request_id","host_id") WHERE "offers"."state" not in ('withdrawn', 'declined', 'expired', 'cancelled');