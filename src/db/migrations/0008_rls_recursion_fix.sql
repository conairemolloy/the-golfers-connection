-- ROOT CAUSE
--
-- A policy that queries its own table inside EXISTS re-enters that
-- table's RLS to evaluate the subquery, which re-enters the policy:
-- infinite recursion, Postgres error 42P17. The fix is to move the
-- check into a SECURITY DEFINER function, which bypasses RLS for the
-- inner lookup. Same pattern already used by private.is_member(),
-- private.is_admin() and private.my_tier() (0006).
--
-- Hit this on round_participants (its SELECT policy queried
-- round_participants) and thread_members (its SELECT policy queried
-- thread_members). rounds, threads, messages and feedback don't
-- self-reference, but they query round_participants/thread_members
-- directly, so they are rewritten to call the same helpers rather than
-- re-entering those tables' RLS via a raw EXISTS.

-- ============================================================
-- New helpers in the private schema
-- ============================================================

-- True if the caller is a participant in the given round. Answers only
-- "am I in this one", never "who else is in it", so SECURITY DEFINER
-- leaks nothing to the caller beyond what the policy would have told
-- them anyway.
CREATE OR REPLACE FUNCTION private.is_round_participant(p_round_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM round_participants
    WHERE round_id = p_round_id AND user_id = auth.uid()
  );
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_round_participant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_round_participant(uuid) TO authenticated;
--> statement-breakpoint

-- True if the caller is a member of the given thread. Answers only "am
-- I in this one", never "who else is in it", so SECURITY DEFINER leaks
-- nothing to the caller beyond what the policy would have told them
-- anyway.
CREATE OR REPLACE FUNCTION private.is_thread_member(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM thread_members
    WHERE thread_id = p_thread_id AND user_id = auth.uid()
  );
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_thread_member(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_thread_member(uuid) TO authenticated;
--> statement-breakpoint

-- ============================================================
-- round_participants — was self-querying, the direct 42P17 case
-- ============================================================

DROP POLICY "round_participants_select_fellow_participant_or_admin" ON "round_participants";
--> statement-breakpoint
CREATE POLICY "round_participants_select_fellow_participant_or_admin" ON "round_participants" FOR SELECT TO authenticated
  USING (
    (select private.is_round_participant(round_participants.round_id))
    OR (select private.is_admin())
  );
--> statement-breakpoint

-- ============================================================
-- thread_members — was self-querying, the direct 42P17 case
-- ============================================================

DROP POLICY "thread_members_select_fellow_member" ON "thread_members";
--> statement-breakpoint
CREATE POLICY "thread_members_select_fellow_member" ON "thread_members" FOR SELECT TO authenticated
  USING (
    (select private.is_thread_member(thread_members.thread_id))
    OR (select private.is_admin())
  );
--> statement-breakpoint

-- ============================================================
-- rounds
-- ============================================================

DROP POLICY "rounds_select_participant_or_admin" ON "rounds";
--> statement-breakpoint
CREATE POLICY "rounds_select_participant_or_admin" ON "rounds" FOR SELECT TO authenticated
  USING (
    (select private.is_round_participant(rounds.id))
    OR (select private.is_admin())
  );
--> statement-breakpoint

-- ============================================================
-- threads
-- ============================================================

DROP POLICY "threads_select_member" ON "threads";
--> statement-breakpoint
CREATE POLICY "threads_select_member" ON "threads" FOR SELECT TO authenticated
  USING (
    (select private.is_thread_member(threads.id))
    OR (select private.is_admin())
  );
--> statement-breakpoint

-- ============================================================
-- messages
-- ============================================================

DROP POLICY "messages_select_thread_member" ON "messages";
--> statement-breakpoint
CREATE POLICY "messages_select_thread_member" ON "messages" FOR SELECT TO authenticated
  USING (
    (select private.is_thread_member(messages.thread_id))
  );
--> statement-breakpoint

DROP POLICY "messages_insert_thread_member_self" ON "messages";
--> statement-breakpoint
CREATE POLICY "messages_insert_thread_member_self" ON "messages" FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND (select private.is_thread_member(messages.thread_id))
  );
--> statement-breakpoint

-- ============================================================
-- feedback — SELECT policy doesn't self-reference, left alone
-- ============================================================

DROP POLICY "feedback_insert_participant_self" ON "feedback";
--> statement-breakpoint
CREATE POLICY "feedback_insert_participant_self" ON "feedback" FOR INSERT TO authenticated
  WITH CHECK (
    from_user = (select auth.uid())
    AND (select private.is_round_participant(feedback.round_id))
  );
