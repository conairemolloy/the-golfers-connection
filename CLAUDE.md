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

## Raw SQL objects (not tracked by Drizzle)

These objects were created by hand in raw SQL migrations (0003, 0004,
0006, 0007) and do not appear in `schema.ts` or any drizzle-kit
snapshot:

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
  `private.my_tier()` (0006) — never exposed to PostgREST, used only
  inside policy expressions
- constraint `profiles_member_needs_name_check` (0006) — display_name
  and initials may be null pre-membership, never once status = 'member'
- function `public.handle_new_user()` + trigger `on_auth_user_created`
  on `auth.users` (0006) — provisions the profiles row at signup; the
  trigger lives on `auth.users`, outside the `public` schema, so it
  can't appear in a Drizzle snapshot regardless
- every RLS policy on every table (0007), and the REVOKE/GRANT pair on
  each table that backs it

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
