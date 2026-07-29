-- Helper functions for RLS policies (migration 0007). Kept in a `private`
-- schema, never exposed to PostgREST, so they can't be called directly by
-- anon or authenticated over the API — only from within policy expressions
-- on tables those roles do have access to.
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated;
--> statement-breakpoint
-- The profiles.id for the calling auth.uid(), or null if no profile row
-- exists yet for this authenticated user.
CREATE OR REPLACE FUNCTION private.current_member()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM profiles WHERE id = auth.uid();
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.current_member() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.current_member() TO authenticated;
--> statement-breakpoint
-- True if a profile exists for the caller and is in good standing
-- (status = 'member'). Applicants, lapsed and removed profiles are not
-- members for the purposes of any policy that calls this.
CREATE OR REPLACE FUNCTION private.is_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'member'
  );
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_member() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_member() TO authenticated;
--> statement-breakpoint
-- True if a profile exists for the caller with status 'applicant' or
-- 'member' — i.e. mid-application or fully in. Exists for the narrow
-- case where an applicant legitimately needs to read something before
-- being a member: naming a home club during the application flow needs
-- the club list, so the clubs/club_courses SELECT policies use this
-- instead of is_member(). Every other table stays gated on is_member() —
-- an applicant has no business reading club_content, club_events, the
-- directory, requests, or anything else.
CREATE OR REPLACE FUNCTION private.is_onboarding()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('applicant', 'member')
  );
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_onboarding() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_onboarding() TO authenticated;
--> statement-breakpoint
-- True if the caller's profile has is_admin set.
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin
  );
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.is_admin() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
--> statement-breakpoint
-- MIN(clubs.tier) across the caller's confirmed memberships, or null if
-- the caller has none. "Confirmed" means verification_state =
-- 'club_confirmed' — that enum is the authoritative test. confirmed_at
-- is an accompanying timestamp of when that happened; it must not be
-- used as the test on its own, since a row could carry a stale
-- confirmed_at without being in the club_confirmed state (e.g. after a
-- re-check downgrades it). Tier 1 is highest, so "your tier or below"
-- means club.tier >= my_tier() — a request_targets insert is allowed
-- when the target club's tier number is at or above (i.e. at or below
-- in prestige) the caller's best tier.
CREATE OR REPLACE FUNCTION private.my_tier()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT MIN(c.tier)
  FROM memberships m
  JOIN clubs c ON c.id = m.club_id
  WHERE m.user_id = auth.uid()
    AND m.verification_state = 'club_confirmed';
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.my_tier() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.my_tier() TO authenticated;
--> statement-breakpoint

-- ============================================================
-- member_balance() — SECURITY DEFINER, re-authorised
-- ============================================================
-- Defined here rather than in 0005: it needs to call private.is_admin(),
-- which doesn't exist until the helpers above are created.
--
-- SECURITY DEFINER is required so member_balance() sees the whole
-- ledger rather than only the rows the ledger_entries SELECT policy
-- exposes to the caller — otherwise it would silently undercount for
-- any admin view, and be misleading for anyone reasoning about it in
-- isolation. But SECURITY DEFINER means the function itself bypasses
-- RLS, so it no longer inherits any authorisation from the policy it
-- bypasses — it has to enforce its own: a caller may only ask for their
-- own balance, unless they're an admin. auth.uid() is null on the
-- service-role/server path, which is left unchecked — server code
-- already bypasses RLS entirely, so there is nothing to re-check.
CREATE OR REPLACE FUNCTION member_balance(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF auth.uid() IS NOT NULL
     AND p_user_id IS DISTINCT FROM auth.uid()
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'member_balance: not permitted for another member';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
  INTO v_balance
  FROM ledger_entries
  WHERE user_id = p_user_id;

  RETURN v_balance;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION member_balance(uuid) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION member_balance(uuid) TO authenticated;
--> statement-breakpoint

-- ============================================================
-- Profile provisioning — auth.users -> profiles
-- ============================================================
-- display_name and initials were NOT NULL with no default. A row
-- inserted at signup, before the member has supplied either, can't
-- satisfy that — so both are relaxed to nullable here, and in
-- schema.ts, to match.
ALTER TABLE "profiles" ALTER COLUMN "display_name" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "initials" DROP NOT NULL;
--> statement-breakpoint
-- Nulls are legitimate between auth signup and completing the
-- application. This constraint is what stops a profile reaching member
-- status without a real name — no placeholder values anywhere, because
-- a placeholder would leak into request cards and the directory looking
-- like real data.
--
-- A failed CHECK on ADD CONSTRAINT reports Postgres's generic "violates
-- check constraint" with no row detail. This gives a readable error
-- naming how many rows are bad, so whoever hits it knows to go fix data
-- rather than debug the migration.
DO $$
DECLARE
  v_bad_count integer;
BEGIN
  SELECT COUNT(*) INTO v_bad_count
  FROM profiles
  WHERE status = 'member' AND (display_name IS NULL OR initials IS NULL);

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'profiles_member_needs_name_check: % existing member row(s) have a null display_name or initials — fix those rows before this migration can apply', v_bad_count;
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_member_needs_name_check"
  CHECK (status <> 'member' OR (display_name IS NOT NULL AND initials IS NOT NULL));
--> statement-breakpoint
-- This is why profiles has no INSERT policy in 0007, and should not get
-- one: rows are provisioned here, by this trigger, never by the client.
-- Without it a brand-new auth user has no profiles row, is_onboarding()
-- is false, and the application flow is dead at step two — naming a
-- home club needs to read clubs, which needs is_onboarding().
--
-- The trigger lives on auth.users, outside the public schema — like the
-- private schema helpers above, it will not appear in schema.ts or any
-- Drizzle snapshot.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, status, is_admin, display_name)
  VALUES (
    NEW.id,
    'applicant',
    false,
    NEW.raw_user_meta_data->>'display_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint
-- The trigger only fires on new signups; any auth user created before
-- this migration would otherwise have no profile row and be
-- permanently locked out — is_onboarding() false forever, no way to
-- even reach the application flow.
INSERT INTO profiles (id, status, is_admin)
SELECT u.id, 'applicant', false FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
