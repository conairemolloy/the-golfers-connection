-- ============================================================
-- Harden the reserved system profile's auth.users row
-- ============================================================
-- 0020_system_profile.sql inserted this row with only `id` set — every
-- other column GoTrue normally populates at signup (email, created_at,
-- raw_user_meta_data, instance_id, aud, role...) was left null, because
-- those requirements live in the auth service, not in a table
-- constraint.
--
-- profiles.id FKs to this row, and every system-authored message
-- (acceptOffer's introduction, src/lib/offers.ts) depends on that FK
-- resolving. A row this malformed-looking is a real risk sitting under
-- a load-bearing FK: a future GoTrue migration adding a NOT NULL
-- column, or an admin sweep of auth rows that don't look like real
-- users, could take it out and break the product loop.
--
-- instance_id/aud/role below are not arbitrary — they're the same
-- values every other row in this project's auth.users already carries
-- (confirmed by querying auth.users directly; see the accompanying
-- report). email is an RFC 2606 reserved, unroutable address —
-- obviously not a person, and not a real domain anyone could receive
-- mail at.
--
-- Deliberately still null: email_confirmed_at. This row has no
-- encrypted_password and no auth.identities row, and now no
-- unconfirmed-but-real email either — nothing in GoTrue's sign-in flow
-- (password grant, magic link, OAuth) has anything to authenticate
-- against, so no sign-in path can ever resolve to this user.
UPDATE auth.users
SET
  email = 'system@thegolfersconnection.invalid',
  created_at = now(),
  updated_at = now(),
  raw_user_meta_data = '{}'::jsonb,
  raw_app_meta_data = '{}'::jsonb,
  instance_id = '00000000-0000-0000-0000-000000000000',
  aud = 'authenticated',
  role = 'authenticated',
  email_confirmed_at = NULL
WHERE id = '00000000-0000-0000-0000-000000000000';
