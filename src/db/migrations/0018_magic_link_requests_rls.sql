-- magic_link_requests — service role only, same as domain_events/audit_log.
-- Only sendMagicLink (src/lib/auth.ts) ever touches this table, over the
-- `postgres` role connection that bypasses RLS entirely — no client should
-- ever read or write it directly, so it gets no policies at all.

ALTER TABLE "magic_link_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- RLS enabled and no policies means deny-all already; this REVOKE is the
-- second, independent lock, same reasoning as audit_log/domain_events.
REVOKE ALL ON "magic_link_requests" FROM anon, authenticated;