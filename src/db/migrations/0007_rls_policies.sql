-- THREAT MODEL
--
-- The application server connects to Postgres as the `postgres` role and
-- bypasses row level security entirely. These policies do nothing to
-- protect that path and are not meant to.
--
-- What they defend is the PostgREST path: any request made directly
-- against Supabase's auto-generated REST API using the publishable
-- (anon) key, which ships in every browser bundle and is not a secret.
-- Anyone can pull that key out of the client and issue arbitrary
-- PostgREST calls carrying an `anon` or `authenticated` JWT. Treat
-- everything reachable by those two roles as reachable by a hostile
-- actor, not just by our own application code.
--
-- Two consequences that shape every policy below:
--   - `anon` gets nothing, anywhere. There is no unauthenticated read
--     or write on any table.
--   - `authenticated` is a real member's session, but a hostile member
--     can send any request PostgREST accepts for that role, not just the
--     ones the app's UI happens to construct. Policies must hold against
--     an arbitrary query shape, not merely the queries our own code
--     issues.
--
-- Grants are a second lock, independent of policy logic: a table with no
-- GRANT to a role is unreachable by that role regardless of what any
-- policy says, so every table below gets an explicit REVOKE ALL FROM
-- anon and a GRANT to authenticated naming only the verbs a policy
-- actually permits.

-- PER-ROW FUNCTION CALLS
--
-- Every auth.uid() and private.* call below is wrapped in a scalar
-- subquery — (select auth.uid()), (select private.is_admin()), etc.
-- Unwrapped, Postgres treats these as volatile in policy position and
-- re-evaluates them once per row scanned; wrapped, the planner hoists
-- them into an InitPlan and evaluates once per query. Do not "simplify"
-- this by removing the (select ...) wrapper — it is a deliberate
-- performance choice, not leftover noise.

-- ============================================================
-- Reference data — SELECT for members, writes admin only
-- ============================================================

ALTER TABLE "clubs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "clubs" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "clubs" TO authenticated;
--> statement-breakpoint
-- Applicants need the club list to name their home club during
-- application, and nothing further — this is the one reference table an
-- applicant (not yet a member) may read. Uses is_onboarding(), not
-- is_member().
CREATE POLICY "clubs_select_onboarding" ON "clubs" FOR SELECT TO authenticated
  USING ((select private.is_onboarding()));
--> statement-breakpoint
CREATE POLICY "clubs_admin_write" ON "clubs" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

ALTER TABLE "club_courses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "club_courses" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "club_courses" TO authenticated;
--> statement-breakpoint
-- Same reasoning as clubs — an applicant naming a home club may need to
-- see its courses.
CREATE POLICY "club_courses_select_onboarding" ON "club_courses" FOR SELECT TO authenticated
  USING ((select private.is_onboarding()));
--> statement-breakpoint
CREATE POLICY "club_courses_admin_write" ON "club_courses" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

ALTER TABLE "club_content" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "club_content" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "club_content" TO authenticated;
--> statement-breakpoint
CREATE POLICY "club_content_select_members" ON "club_content" FOR SELECT TO authenticated
  USING ((select private.is_member()));
--> statement-breakpoint
CREATE POLICY "club_content_admin_write" ON "club_content" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

ALTER TABLE "club_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "club_events" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "club_events" TO authenticated;
--> statement-breakpoint
CREATE POLICY "club_events_select_members" ON "club_events" FOR SELECT TO authenticated
  USING ((select private.is_member()));
--> statement-breakpoint
CREATE POLICY "club_events_admin_write" ON "club_events" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "feature_flags" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "feature_flags" TO authenticated;
--> statement-breakpoint
CREATE POLICY "feature_flags_select_members" ON "feature_flags" FOR SELECT TO authenticated
  USING ((select private.is_member()));
--> statement-breakpoint
CREATE POLICY "feature_flags_admin_write" ON "feature_flags" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

-- club_releases (P6) does not exist yet — no table to secure. Add its
-- policies in the migration that creates it.

-- ============================================================
-- profiles
-- ============================================================

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "profiles" FROM anon;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "profiles" TO authenticated;
--> statement-breakpoint
CREATE POLICY "profiles_select_members_and_self" ON "profiles" FOR SELECT TO authenticated
  USING (id = (select auth.uid()) OR ((select private.is_member()) AND status = 'member'));
--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" FOR UPDATE TO authenticated
  USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));
--> statement-breakpoint
-- No INSERT or DELETE policy: profiles are created by the auth trigger
-- and never by API insert; deletion is a soft delete via UPDATE.

-- ============================================================
-- memberships, handicaps — SELECT for members, writes admin only
-- ============================================================

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "memberships" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO authenticated;
--> statement-breakpoint
CREATE POLICY "memberships_select_members" ON "memberships" FOR SELECT TO authenticated
  USING ((select private.is_member()));
--> statement-breakpoint
CREATE POLICY "memberships_admin_write" ON "memberships" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

ALTER TABLE "handicaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "handicaps" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "handicaps" TO authenticated;
--> statement-breakpoint
CREATE POLICY "handicaps_select_members" ON "handicaps" FOR SELECT TO authenticated
  USING ((select private.is_member()));
--> statement-breakpoint
CREATE POLICY "handicaps_admin_write" ON "handicaps" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

-- ============================================================
-- verifications
-- ============================================================

ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "verifications" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "verifications" TO authenticated;
--> statement-breakpoint
CREATE POLICY "verifications_select_own_or_admin" ON "verifications" FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select private.is_admin()));
--> statement-breakpoint
CREATE POLICY "verifications_admin_write" ON "verifications" FOR ALL TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

-- ============================================================
-- invitations
-- ============================================================

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "invitations" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "invitations" TO authenticated;
--> statement-breakpoint
CREATE POLICY "invitations_select_own_or_admin" ON "invitations" FOR SELECT TO authenticated
  USING (issued_by = (select auth.uid()) OR (select private.is_admin()));
--> statement-breakpoint
CREATE POLICY "invitations_insert_own" ON "invitations" FOR INSERT TO authenticated
  WITH CHECK ((select private.is_member()) AND issued_by = (select auth.uid()));
--> statement-breakpoint

-- ============================================================
-- applications
-- ============================================================

ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "applications" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "applications" TO authenticated;
--> statement-breakpoint
CREATE POLICY "applications_select_own_or_admin" ON "applications" FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select private.is_admin()));
--> statement-breakpoint
CREATE POLICY "applications_insert_own" ON "applications" FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY "applications_update_admin" ON "applications" FOR UPDATE TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
--> statement-breakpoint

-- ============================================================
-- endorsements
-- ============================================================

ALTER TABLE "endorsements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "endorsements" FROM anon;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "endorsements" TO authenticated;
--> statement-breakpoint
CREATE POLICY "endorsements_select_endorser_applicant_or_admin" ON "endorsements" FOR SELECT TO authenticated
  USING (
    endorser_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = endorsements.application_id AND a.user_id = (select auth.uid())
    )
    OR (select private.is_admin())
  );
--> statement-breakpoint
CREATE POLICY "endorsements_update_endorser" ON "endorsements" FOR UPDATE TO authenticated
  USING (endorser_id = (select auth.uid())) WITH CHECK (endorser_id = (select auth.uid()));
--> statement-breakpoint

-- ============================================================
-- requests
-- ============================================================

ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "requests" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "requests" TO authenticated;
--> statement-breakpoint
CREATE POLICY "requests_select_own_or_open_member" ON "requests" FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR ((select private.is_member()) AND state = 'open'));
--> statement-breakpoint
CREATE POLICY "requests_insert_own" ON "requests" FOR INSERT TO authenticated
  WITH CHECK ((select private.is_member()) AND user_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY "requests_update_own" ON "requests" FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
--> statement-breakpoint

-- ============================================================
-- request_targets — this is where the tier rule lives
-- ============================================================

ALTER TABLE "request_targets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "request_targets" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "request_targets" TO authenticated;
--> statement-breakpoint
CREATE POLICY "request_targets_select_parent_visible" ON "request_targets" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_targets.request_id
        AND (r.user_id = (select auth.uid()) OR ((select private.is_member()) AND r.state = 'open'))
    )
  );
--> statement-breakpoint
-- Enforced here, in the database, not in application code: the caller
-- must own the parent request, and the target club's tier must be the
-- caller's tier or below. Tier 1 is highest, so "or below" means
-- club.tier >= my_tier().
--
-- Fail-closed by construction: my_tier() returns NULL when the caller
-- has no club_confirmed membership, and club.tier >= NULL evaluates to
-- NULL, which RLS treats as deny. A member whose club membership is not
-- yet confirmed can create a request but cannot target any club with it
-- — that is intended, not a gap to fix.
CREATE POLICY "request_targets_insert_own_request_within_tier" ON "request_targets" FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM requests r WHERE r.id = request_targets.request_id AND r.user_id = (select auth.uid()))
    AND (SELECT tier FROM clubs WHERE id = request_targets.club_id) >= (select private.my_tier())
  );
--> statement-breakpoint

-- ============================================================
-- offers
-- ============================================================

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "offers" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "offers" TO authenticated;
--> statement-breakpoint
CREATE POLICY "offers_select_host_requester_or_admin" ON "offers" FOR SELECT TO authenticated
  USING (
    host_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM requests r WHERE r.id = offers.request_id AND r.user_id = (select auth.uid()))
    OR (select private.is_admin())
  );
--> statement-breakpoint
CREATE POLICY "offers_insert_host" ON "offers" FOR INSERT TO authenticated
  WITH CHECK ((select private.is_member()) AND host_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY "offers_update_host_or_requester" ON "offers" FOR UPDATE TO authenticated
  USING (
    host_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM requests r WHERE r.id = offers.request_id AND r.user_id = (select auth.uid()))
  )
  WITH CHECK (
    host_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM requests r WHERE r.id = offers.request_id AND r.user_id = (select auth.uid()))
  );
--> statement-breakpoint

-- ============================================================
-- rounds, round_participants — read only via API
-- ============================================================

ALTER TABLE "rounds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "rounds" FROM anon;
--> statement-breakpoint
GRANT SELECT ON "rounds" TO authenticated;
--> statement-breakpoint
CREATE POLICY "rounds_select_participant_or_admin" ON "rounds" FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM round_participants rp WHERE rp.round_id = rounds.id AND rp.user_id = (select auth.uid()))
    OR (select private.is_admin())
  );
--> statement-breakpoint
-- No write policy and nothing granted beyond SELECT: rounds are written
-- server-side as part of the offer/confirmation flow.

ALTER TABLE "round_participants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "round_participants" FROM anon;
--> statement-breakpoint
GRANT SELECT ON "round_participants" TO authenticated;
--> statement-breakpoint
CREATE POLICY "round_participants_select_fellow_participant_or_admin" ON "round_participants" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM round_participants rp2
      WHERE rp2.round_id = round_participants.round_id AND rp2.user_id = (select auth.uid())
    )
    OR (select private.is_admin())
  );
--> statement-breakpoint

-- ============================================================
-- ledger_entries — service role only for writes
-- ============================================================

ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "ledger_entries" FROM anon;
--> statement-breakpoint
-- SELECT only. No INSERT, UPDATE or DELETE is granted to authenticated
-- at all — ledger writes happen only through the service-role connection
-- on mutual confirmation, which bypasses RLS entirely. The immutability
-- and no-truncate triggers from migrations 0003/0004 are the backstop
-- against UPDATE/DELETE/TRUNCATE even for a role that did have grants.
GRANT SELECT ON "ledger_entries" TO authenticated;
--> statement-breakpoint
CREATE POLICY "ledger_entries_select_own_or_admin" ON "ledger_entries" FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select private.is_admin()));
--> statement-breakpoint

-- ============================================================
-- threads, thread_members — created server-side only
-- ============================================================

ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "threads" FROM anon;
--> statement-breakpoint
GRANT SELECT ON "threads" TO authenticated;
--> statement-breakpoint
CREATE POLICY "threads_select_member" ON "threads" FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM thread_members tm WHERE tm.thread_id = threads.id AND tm.user_id = (select auth.uid()))
  );
--> statement-breakpoint
-- No write policy and nothing granted beyond SELECT: per the domain rule,
-- threads are created only by an accepted offer, an itinerary or a
-- fixture, server-side. No code path may create a thread from a profile,
-- and the API grants make that true at the database level too.

ALTER TABLE "thread_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "thread_members" FROM anon;
--> statement-breakpoint
GRANT SELECT ON "thread_members" TO authenticated;
--> statement-breakpoint
CREATE POLICY "thread_members_select_fellow_member" ON "thread_members" FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM thread_members tm2
      WHERE tm2.thread_id = thread_members.thread_id AND tm2.user_id = (select auth.uid())
    )
  );
--> statement-breakpoint

-- ============================================================
-- messages
-- ============================================================

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "messages" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "messages" TO authenticated;
--> statement-breakpoint
CREATE POLICY "messages_select_thread_member" ON "messages" FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM thread_members tm WHERE tm.thread_id = messages.thread_id AND tm.user_id = (select auth.uid()))
  );
--> statement-breakpoint
CREATE POLICY "messages_insert_thread_member_self" ON "messages" FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (SELECT 1 FROM thread_members tm WHERE tm.thread_id = messages.thread_id AND tm.user_id = (select auth.uid()))
  );
--> statement-breakpoint

-- ============================================================
-- feedback — blind release enforced here, in the database
-- ============================================================

ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "feedback" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "feedback" TO authenticated;
--> statement-breakpoint
-- Feedback about you is invisible until released_at is set — the blind
-- release mechanic. A hostile member cannot read it early by any query
-- shape, because the row simply isn't visible to them yet.
CREATE POLICY "feedback_select_own_or_released_about_self" ON "feedback" FOR SELECT TO authenticated
  USING (from_user = (select auth.uid()) OR (to_user = (select auth.uid()) AND released_at IS NOT NULL));
--> statement-breakpoint
CREATE POLICY "feedback_insert_participant_self" ON "feedback" FOR INSERT TO authenticated
  WITH CHECK (
    from_user = (select auth.uid())
    AND EXISTS (SELECT 1 FROM round_participants rp WHERE rp.round_id = feedback.round_id AND rp.user_id = (select auth.uid()))
  );
--> statement-breakpoint
-- No UPDATE policy and none granted: feedback is not editable once
-- submitted.

-- ============================================================
-- reports — the quiet word
-- ============================================================

ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "reports" FROM anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "reports" TO authenticated;
--> statement-breakpoint
CREATE POLICY "reports_select_own_or_admin" ON "reports" FOR SELECT TO authenticated
  USING (from_user = (select auth.uid()) OR (select private.is_admin()));
--> statement-breakpoint
CREATE POLICY "reports_insert_own" ON "reports" FOR INSERT TO authenticated
  WITH CHECK (from_user = (select auth.uid()));
--> statement-breakpoint

-- ============================================================
-- audit_log — service role only, no policies at all
-- ============================================================

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- RLS enabled and no policies means deny-all already; this REVOKE is the
-- second, independent lock — even a future accidental CREATE POLICY
-- can't open a hole here without a matching GRANT that doesn't exist.
-- Service role only.
REVOKE ALL ON "audit_log" FROM anon, authenticated;

-- domain_events does not exist yet — no table to secure. Add its policy
-- (also none-for-authenticated, service role only) in the migration that
-- creates it.
