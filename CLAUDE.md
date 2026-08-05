# Project conventions

ROADMAP.md in the project root is the source of truth for project state, phases and invariants. Read it at the start of any session.

> See [AGENTS.md](./AGENTS.md): this Next.js version may differ from training data — check `node_modules/next/dist/docs/` before relying on prior knowledge of its APIs.

## Stack

- Next.js (App Router), TypeScript (strict mode)
- pnpm
- Tailwind CSS
- Drizzle ORM + drizzle-kit, postgres-js driver
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- Zod

## Structure

```
/src/app            routes
/src/db             schema.ts, index.ts (drizzle client), migrations/
/src/lib            shared utilities
/src/lib/env.ts     environment variables parsed and validated with Zod,
                    throwing at startup if any are missing
```

## Rules

- Server Components by default; `"use client"` only where interactivity genuinely requires it.
- All external input validated with Zod at the boundary.
- Database constraints enforce invariants, not application code.

## Domain rules

- Message threads may only be created by an accepted offer, an itinerary, or a fixture. There must be no code path that creates a thread from a user profile.
- `ledger_entries` is append-only; corrections are new rows.
- Balance is always derived via `member_balance()`, never stored.
- Ledger entries are written on mutual confirmation only, never on offer acceptance.
- A club is not a course; rounds reference `club_courses`.
- Tee times store local time plus timezone, never UTC alone.
- Hosting is never gated on standing; requesting is. `createRequest` checks standing, `makeOffer` deliberately does not — a member deep in debit should be encouraged to host, not blocked from the one action that fixes his balance. Do not add a standing check to `makeOffer` for symmetry with `createRequest`.
- One accepted offer does not fill a request. A request may name several clubs and accept several offers; the requester (or the expiry job, if an offer was accepted) closes it explicitly to `'filled'`.
- A cancelled round is terminal: never re-confirmed, never re-settled. If it happens after all, it's a new round.

## Raw SQL objects (not tracked by Drizzle)

These objects were created by hand in raw SQL migrations (0003, 0004,
0006, 0007, 0008, 0010, 0013, 0016, 0018) and do not appear in
`schema.ts` or any drizzle-kit snapshot:

- trigger `ledger_entries_no_update_or_delete` + function
  `ledger_entries_immutable()`
- trigger `ledger_entries_no_truncate` + function
  `ledger_entries_no_truncate()`
- function `member_balance(uuid)` — SECURITY DEFINER as of 0006, so it
  sums every row for the given user regardless of the caller's RLS
  visibility, and re-checks its own caller (self, or admin) since
  SECURITY DEFINER means it no longer inherits that from RLS
- constraint `ledger_entries_amount_positive_check`
- table and constraint comments on `ledger_entries`
- `private` schema helper functions: `private.current_member()`,
  `private.is_member()`, `private.is_onboarding()`, `private.is_admin()`,
  `private.my_tier()` (0006), `private.is_round_participant(uuid)`,
  `private.is_thread_member(uuid)` (0008) — never exposed to PostgREST,
  used only inside policy expressions. The 0008 pair exists because a
  policy that queries its own table inside EXISTS recurses (42P17);
  routing the check through a SECURITY DEFINER function bypasses RLS
  for the inner lookup instead of re-entering the policy.
  `private.my_tier(uuid)` (0013) is the parameterised sibling of
  `private.my_tier()` — the zero-arg form still exists (0007's
  request_targets_insert_own_request_within_tier policy calls it) but is
  now just `select private.my_tier(auth.uid())`; the one-arg form is the
  actual formula, called with an explicit user id by
  src/lib/requests.ts's tier check. CREATE OR REPLACE cannot turn a
  zero-arg function into this one — different argument lists are
  different overloads to Postgres — which is why both exist rather than
  one function with a default.
- constraint `profiles_member_needs_name_check` (0006) — display_name
  and initials may be null pre-membership, never once status = 'member'
- function `public.handle_new_user()` + trigger `on_auth_user_created`
  on `auth.users` (0006) — provisions the profiles row at signup; the
  trigger lives on `auth.users`, outside the `public` schema, so it
  can't appear in a Drizzle snapshot regardless
- every RLS policy on every table (0007; round_participants,
  thread_members, rounds, threads, messages and feedback's INSERT
  policy rewritten in 0008; domain_events and host_availability added
  in 0010; host_declines added in 0016; magic_link_requests added in
  0018), and the REVOKE/GRANT pair on each table that backs it —
  domain_events is service-role-only like audit_log (RLS enabled, no
  policies, no grants), host_availability's INSERT additionally checks
  for a club_confirmed membership at the target club via a plain EXISTS
  against memberships (not a self-reference, so no helper needed),
  host_declines' SELECT is the declining host or the request owner (a
  plain EXISTS against requests, same shape as offers' SELECT policy)
  and its INSERT is host-only, magic_link_requests is service-role-only
  like domain_events/audit_log — table itself is Drizzle-tracked (0017,
  schema.ts's magicLinkRequests), only the RLS/REVOKE follow-up (0018)
  is hand-managed, same split as host_availability's 0009/0010

`profiles.is_admin` is the one exception — it goes through `schema.ts`
and drizzle-kit as normal (0005). `profiles.display_name` and
`profiles.initials` becoming nullable also goes through `schema.ts`
(0006 raw SQL applies the `DROP NOT NULL`, but the column definitions
themselves are Drizzle-tracked) — only the CHECK constraint enforcing
them by member status is hand-managed.

They are managed by hand in raw SQL migrations. Do not add them to
`schema.ts` — drizzle-kit would then generate a duplicate CREATE/ADD
and the migration would fail against a database where they already
exist. Changes to any of them go in a new raw SQL migration.

## Session economy

- Read only what the task names. ROADMAP.md is long — read the specific
  sections a prompt points at, not the whole file, unless asked to.
- Do not read node_modules to verify an API unless there is specific
  reason to doubt it (a version mismatch, a deprecation warning, an
  error that suggests the signature changed). Check the bundled docs in
  node_modules/next/dist/docs when the task touches Next.js
  conventions — that is the exception, per AGENTS.md.
- When showing generated output for review, show the parts asked for and
  summarise the rest. Do not print a full migration or a full file
  unless asked.
- Prefer targeted grep over reading whole files.

## Design tokens

For later UI work.

| Token   | Hex       |
| ------- | --------- |
| lacquer | `#0D2B22` |
| deep    | `#061713` |
| raised  | `#123529` |
| paper   | `#EFEADC` |
| gilt    | `#B08D3F` |
| bright  | `#D4B160` |
| ink     | `#16201C` |
| stone   | `#8B9A92` |
| credit  | `#4E7A5C` |
| debit   | `#9A5B3C` |

Fonts:

- Newsreader — display serif
- Archivo — body
- IBM Plex Mono — figures and metadata
