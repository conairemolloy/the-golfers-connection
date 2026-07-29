# Project conventions

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
