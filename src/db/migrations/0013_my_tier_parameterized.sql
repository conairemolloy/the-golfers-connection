-- private.my_tier() only ever answered "my tier" for the calling
-- session (auth.uid()), which is fine for the request_targets INSERT
-- policy but useless to the service layer, which needs the same rule
-- for an arbitrary member passed as an argument, not the caller.
--
-- CREATE OR REPLACE cannot turn a zero-arg function into a one-arg one
-- with a default — Postgres treats functions of the same name but a
-- different argument list as separate overloads, not a replacement, so
-- naively adding a defaulted parameter here would leave two independent
-- copies of the tier formula to keep in sync. Instead: the one-argument
-- form becomes the single source of truth, and the zero-argument form
-- (still what 0007_rls_policies.sql's
-- request_targets_insert_own_request_within_tier policy calls, and
-- still valid Postgres — same signature, so CREATE OR REPLACE genuinely
-- replaces it in place) is reduced to a one-line delegation to it.
--
-- The DROP guards a dev-only false start: an earlier version of this
-- migration briefly created private.my_tier(uuid) with a default before
-- landing on the two-function design below, and Postgres refuses to
-- CREATE OR REPLACE a default away. IF EXISTS makes this a no-op on any
-- database that never saw that version, including a fresh one.
DROP FUNCTION IF EXISTS private.my_tier(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.my_tier(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT MIN(c.tier)
  FROM memberships m
  JOIN clubs c ON c.id = m.club_id
  WHERE m.user_id = p_user_id
    AND m.verification_state = 'club_confirmed';
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.my_tier(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.my_tier(uuid) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.my_tier()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT private.my_tier(auth.uid());
$$;
