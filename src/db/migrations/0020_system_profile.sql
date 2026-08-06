-- ============================================================
-- Reserved system profile — auto-posted introductions
-- ============================================================
-- The first message in a round thread (acceptOffer, src/lib/offers.ts)
-- is authored by this profile rather than by either participant, and
-- rather than by a null sender_id — messages.sender_id stays NOT NULL
-- so no consumer of messages ever needs a null-sender branch.
--
-- This row is never a real member: it must never appear in the member
-- directory, must never receive a ledger entry, and must be excluded
-- from member counts the same way fixture rows are. There is no
-- application code path that authenticates as this user or adds it to
-- thread_members — id 00000000-0000-0000-0000-000000000000 is reserved
-- and unmistakable specifically so it's easy to filter out wherever
-- those exclusions are implemented.
--
-- profiles.id is a foreign key to auth.users.id, so a matching
-- auth.users row is required first. That insert fires the
-- on_auth_user_created trigger from 0006_rls_helpers.sql, which
-- provisions its own stub profiles row (status 'applicant', null
-- name) — the INSERT ... ON CONFLICT below overwrites that stub with
-- this row's real values rather than relying on the trigger's
-- ON CONFLICT DO NOTHING to have skipped it.
INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO profiles (id, display_name, initials, status, is_admin)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'The Golfers'' Connection',
  'GC',
  'member',
  false
)
ON CONFLICT (id) DO UPDATE SET
  display_name = excluded.display_name,
  initials = excluded.initials,
  status = excluded.status,
  is_admin = excluded.is_admin;
