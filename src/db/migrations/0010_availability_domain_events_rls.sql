-- RLS for the two Prompt F tables created in 0009.

-- ============================================================
-- domain_events — service role only, same as audit_log
-- ============================================================

ALTER TABLE "domain_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- RLS enabled and no policies means deny-all already; this REVOKE is the
-- second, independent lock, same reasoning as audit_log.
REVOKE ALL ON "domain_events" FROM anon, authenticated;
--> statement-breakpoint

-- ============================================================
-- host_availability
-- ============================================================

ALTER TABLE "host_availability" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "host_availability" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "host_availability" TO authenticated;
--> statement-breakpoint
-- Members need to see availability to understand why a match surfaced, not
-- just their own rows.
CREATE POLICY "host_availability_select_own_or_active_member" ON "host_availability" FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR ((select private.is_member()) AND active)
  );
--> statement-breakpoint
-- No self-reference here (this policy never queries host_availability),
-- so no SECURITY DEFINER helper is needed for the membership check — it's
-- a plain EXISTS against memberships, a different table.
CREATE POLICY "host_availability_insert_own_confirmed_club" ON "host_availability" FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = (select auth.uid())
        AND m.club_id = host_availability.club_id
        AND m.verification_state = 'club_confirmed'
    )
  );
--> statement-breakpoint
CREATE POLICY "host_availability_update_own" ON "host_availability" FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY "host_availability_delete_own" ON "host_availability" FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================
-- round_participants — no policy change
-- ============================================================
-- user_id is nullable as of 0009 (a plus-one row has none). Verified this
-- does not weaken round_participants_select_fellow_participant_or_admin
-- (rewritten in 0008): it gates on private.is_round_participant(round_id)
-- and private.is_admin(), neither of which reads this row's own user_id —
-- visibility is "can the caller see this round", not "does this row belong
-- to the caller". A plus-one row is visible to every participant of that
-- round exactly like any other row on it. No change needed.
