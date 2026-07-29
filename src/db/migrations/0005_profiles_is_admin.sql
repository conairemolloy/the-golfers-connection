ALTER TABLE "profiles" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- member_balance() also needs to become SECURITY DEFINER for M2a (so it
-- sees the whole ledger, not just what RLS exposes to the caller), and
-- that rewrite needs to call private.is_admin() to re-authorise itself.
-- private.is_admin() doesn't exist until 0006, so the redefinition of
-- member_balance() lives at the end of 0006, after the helpers it
-- depends on, rather than here.