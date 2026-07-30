# The Golfers' Connection — Roadmap
### A private reciprocal access network for members of elite clubs in Ireland and Britain
*Last updated: 31 July 2026 (M4c complete — host availability matching and graceful decline)*

---

## Read This First
> Orientation for any new session, chat, or contributor. Start here.

**What we're building.** A vetted, invitation-only network where members
of serious golf clubs host each other. A member posts where he's
travelling; another member offers a game at his club and plays alongside
him. Reciprocity is enforced by a double-entry ledger, not by goodwill
or a committee.

**Who's involved.** Conaire (build, data, product) and Nicholl (golf
network, club relationships, member acquisition, vetting judgement).

**Where the code is.** github.com/conairemolloy/the-golfers-connection
Stack: Next.js 16 App Router, TypeScript strict, Tailwind, Drizzle ORM
(postgres-js), Supabase (Postgres + Auth + RLS + Storage), Zod, pnpm.
Supabase project `golfers-connection-dev`, region West EU (Ireland).

**Where we are.** See "Currently Done" below, then the first unchecked
box in the Build Phases section. That is the next thing to work on.

**Now working on.** M4's service layer is done — request creation, the
Book query, the offer flow with mutual confirmation, host availability
matching and graceful decline. The Playwright journey test (request →
offer → accept → confirm → ledger entry → balance moves) is still
outstanding: it needs UI/routes to drive, which M4 deliberately built
none of. Pick it up alongside M5, or whenever the first route lands.
Next up is M5 — Correspondence.

**Parallel tracks.** Build Phases (M0–M11) and the Content Workstream
(C1–C4) run at the same time. Content is not code and does not block
on it — it decides launch quality more than any feature does.

**Design reference.** /design holds the app and landing prototypes.
They are the visual spec.

**The three things that matter most.**
1. The ledger must be perfect. Everything else is rebuildable.
2. Host ratio is the health metric. Below 30% the network is dying
   whatever revenue says.
3. No money ever passes between members for a round. That is brokering
   tee times and it ends the business.

**How to update this file.** Tick boxes as work completes. Add newly
discovered gotchas to "Things That Will Bite You". Move decisions from
"Open Decisions" into "Invariants" or the relevant phase once settled.
Update the date at the top. Commit with the work it describes, not
separately.

---

## What This Is

A vetted, invitation-only network where members of serious golf clubs
host each other. The guest fee goes to the club at the club's own rate.
Revenue is annual membership, plus referral fees on trips arranged
through a licensed partner operator — never a cut of a green fee.

**The wedge:** every competitor is broad and shallow. Nobody owns Irish
and British links depth, nobody handles the *week* rather than the
single round, and nobody has made clubs participants rather than
obstacles.

---

## Currently Done

- [x] Next.js 16 (App Router) + TypeScript strict, Tailwind, pnpm
- [x] Drizzle ORM + drizzle-kit, postgres-js driver
- [x] Supabase provisioned — West EU (Ireland), automatic RLS on,
      auto-expose new tables off
- [x] Zod env validation failing fast at startup
- [x] ESLint + Prettier, VS Code format-on-save
- [x] CLAUDE.md with conventions, domain rules, design tokens
- [x] GitHub repo, private, pushed
- [x] health_check migration applied, /api/health returning
      {ok:true, db:"connected"}
- [x] Session pooler connection verified (port 5432, not 6543)

---

## Setup & Accounts

- [x] GitHub — private repo
- [x] Supabase dev project
- [ ] Vercel — import repo, four env vars, preview deploys per branch
- [ ] Name decision + trademark clearance (UKIPO/EUIPO free search)
- [ ] Domain — .com plus .ie or .co.uk, Cloudflare for DNS
- [ ] Resend — needs domain first; SPF/DKIM/DMARC at least 3 weeks
      before the first invitation
- [ ] Sentry — free tier, wire early
- [ ] Supabase prod project — separate from dev, before real member data
- [ ] Stripe — not until charging. Deliberately deferred.

> **Naming blocks more than it looks.** No domain → no email → no
> invitations → no invite-only model. Settle it while building schema.

---

## Invariants
> These never change. Everything else is negotiable. Read before
> writing any prompt or PR.

- **ledger_entries is append-only.** UPDATE and DELETE revoked at the
  database level. Corrections are new rows with a reason.
- **Balance is always derived** via member_balance(). Never stored.
- **Ledger writes on mutual confirmation only** — never on offer
  acceptance. An accepted offer nobody played must not move a balance.
- **A club is not a course.** Rounds reference club_courses.
- **Tee times store local time plus timezone**, never UTC alone.
- **Threads are created only by an accepted offer, an itinerary, or a
  fixture.** No code path may create a thread from a profile.
- **Nothing is anonymous.** Feedback is unattributed, delayed,
  thresholded — and the UI says exactly that. Never the word anonymous.
- **No commission on a green fee, ever.**

---

## Design Tokens

| Token | Hex | Use |
|---|---|---|
| lacquer | `#0D2B22` | primary ground |
| deep | `#061713` | page background |
| raised | `#123529` | cards, raised surfaces |
| paper | `#EFEADC` | documents — ledger, passport, statements |
| gilt | `#B08D3F` | accent, rules, labels |
| bright | `#D4B160` | display type, emphasis |
| ink | `#16201C` | text on paper |
| stone | `#8B9A92` | secondary text |
| credit | `#4E7A5C` | ledger credits |
| debit | `#9A5B3C` | ledger debits |

**Type:** Newsreader (display serif) · Archivo (body/UI) · IBM Plex
Mono (figures, metadata, labels)

**Direction:** honours board, members' handbook, fixture card. Printed
matter, not screens. Dark lacquered shell, paper documents inside it.
Hairline rules, narrow measure, almost no border radius, no shadow, no
gradient. Sentence case throughout.

**Signature element:** the reciprocity ledger rendered as a club account
statement — dated entries, hosted and visited in two columns, ruled
lines, running balance. Not a points bar.

---

# Build Phases

## M0 — Foundations
- [x] Repo, CI, Drizzle migrations
- [x] Env validation, health route
- [ ] Seed script — real club list from src/db/seed/clubs.json,
      plus 60 synthetic members, 200 rounds, populated ledger
- [ ] Sentry wired
- [ ] Vercel preview deploys

*Done when `pnpm seed` gives a database you can develop against.*

## M1 — Domain schema
- [x] All tables per spec, pgEnums for every enumerated type
- [x] Ledger immutability trigger (raises on UPDATE/DELETE)
- [x] member_balance(uuid) SQL function
- [x] Unique constraints: (round_id, user_id, direction),
      idempotency_key, (round_id, from_user), (user_id, club_id),
      (application_id, role)
- [x] Indexes on all FKs, plus requests(state, date_from) and
      offers(request_id, state)
- [x] Drop health_check, point /api/health at `select 1`
- [x] `domain_events` — id, kind, entity, entity_id, payload jsonb,
      created_at, processed_at nullable, attempts int
- [x] `host_availability` — id, user_id, club_id, course_id nullable,
      weekday or date range, capacity int, min_tier, note, active
- [x] `round_participants` handles non-member plus-ones — nullable
      user_id plus guest_name, is_member bool
- [x] `rounds` carries snapshotted form fields — dress, caddie fee,
      guest fee copied from club_content at confirmation
- [x] `profiles.pace_preference` enum(brisk|steady|no_preference)
- [x] `requests.pace_preference` same enum

## M2 — Identity and RLS
- [ ] Magic link auth, no passwords, 90-day sessions
- [x] RLS policy on every table
- [x] hostile_member test fixture
- [x] Automated test: hostile member cannot read the directory, another
      member's ledger, another member's threads, or any table by direct
      PostgREST call

*Join tables are where the leaks are — request_targets, thread_members,
round_participants. Test every one.*

## M3 — The ledger
- [x] Entry writes, idempotency
- [x] Balance derivation, standing thresholds
- [x] Unit tests: double-write, out-of-order confirmation, corrections
- [x] Property test: balance always equals sum of entries
- [x] Parallel-request test for the confirm race
- [x] Cancellation reversal — compensating entry with a reason,
      never a delete. Decided path before it's needed in anger.
- [x] Plus-one rule: the member carries the debit for his guest too

*The only thing that must be perfect. Everything else is rebuildable in
a weekend.*

## M4 — The Book
- [x] Request creation, tier filtering, request_targets
- [x] The Book query — listBook, scoped to clubs the viewer is
      confirmed at, discretion-mode masking, keyset-cursor pagination
- [x] Offer flow and full state machine
- [x] Mutual confirmation → ledger write
- [x] Request expiry job
- [ ] Playwright: request → offer → accept → confirm → ledger entry →
      balance moves
- [x] Host availability matching — a host declares a window once,
      matching runs automatically, he's nudged only on a fit
- [x] Graceful decline — one tap: not this time / try me in September /
      ask Jim at Castlerock instead
- [x] Unfilled request capture — expired-with-no-offer rows retained
      and queryable, never discarded

## M5 — Correspondence
- [ ] Threads on accepted offers
- [ ] Messages, read state, mute
- [ ] Round card pinned at top of round thread
- [ ] Trip group threads
- [ ] Test asserting no thread-from-profile code path exists
- [ ] Auto-posted introduction as the first entry in every round
      thread — name, club, member since, handicap, proposer, times
      hosted

## M6 — Clubs
- [ ] Club pages, club_content form guide
- [ ] club_events — maintenance, closures, competitions, news
- [ ] Guest fee, member counts, access difficulty
- [ ] Weather via Open-Meteo, 30-min cache per course
- [ ] Wind line derived from out_bearing / in_bearing vs wind direction
- [ ] Form snapshot written onto the round at confirmation

*"Out into it, home downwind" is the detail members will talk about.
Two integers per course.*

## M7 — Standing
- [ ] Post-round prompts: would you host again / would you play again
- [ ] Marks: kept up, knew the form, good company, straight with
      arrangements
- [ ] Blind release — both submitted or 7 days, whichever first
- [ ] Queued job with retries and dead-letter alert, never a naive cron
- [ ] Threshold at 5 released items
- [ ] The quiet word → admin queue, never scored

## M8 — Admin console
- [ ] Application queue and state transitions
- [ ] Endorsement chasing
- [ ] Club confirmation workflow
- [ ] Member search
- [ ] Ledger correction with mandatory reason
- [ ] Report queue
- [ ] Club content editor
- [ ] Support impersonation
- [ ] Every action written to audit_log

*Done when Nicholl can approve an application, verify a club and handle
a report without asking anything.*

> Build at M8, not M11. Club content is ~150 clubs × 30 minutes of
> typing and can't be scraped reliably — a wrong dress code is worse
> than no dress code. The editor is what makes that delegable.

## M9 — Money and cover
- [ ] Stripe Billing, annual plan, founding rate grandfathered
- [ ] Customer portal, one-click cancellation, dunning emails
- [ ] Cover certificate reference on profile and round card
- [ ] Full subscribe → renew → cancel → lapse cycle against Stripe
      test clocks

## M10 — Notifications
- [ ] Resend + React Email templates
- [ ] Immediate: offer received, offer accepted, new message, feedback
      due, application progress
- [ ] Daily digest: new requests matching your club and tier
- [ ] Per-kind preferences
- [ ] SPF, DKIM, DMARC green; test send lands in Gmail and Outlook
- [ ] ICS calendar feed — read-only subscription of confirmed rounds
      and fixtures

*Digest, not firehose. This audience will not tolerate constant pings.*

## M11 — Hardening
- [ ] Rate limits — requests per season, offers, invitation codes
- [ ] PITR verified by an actual restore into a scratch project
- [ ] Load test on the Book
- [ ] Accessibility pass, reduced motion, keyboard nav
- [ ] Ops dashboard (Metabase over SQL views)

---

# Post-Launch

## P1 — Return-leg prompt
- [ ] Drafted return invitation the moment a round is confirmed
- [ ] Suggested dates suiting both diaries, one tap to send

*Build first. Goodwill fails from friction, not bad intent — you mean
to reciprocate and eighteen months pass. Prompt at maximum warmth,
walking off the 18th.*

## P2 — The Passport
- [ ] Stamps derived from confirmed rounds, verified by host
- [ ] Private by default, toggleable
- [ ] Ranked against the network

*The growth loop. The only feature people join for before they need
access, and every stamp is free supply data.*

## P3 — Games
- [ ] Short-notice fourballs
- [ ] Distance radius (haversine in SQL) and handicap filtering
- [ ] Wind-triggered opportunistic matching

*Access is three times a year. A game is weekly.*

## P4 — Trips
- [ ] Itinerary as parent object over multiple requests
- [ ] Leg states, trip group thread
- [ ] Partner operator referral handoff — introducer only, never
      the organiser

## P5 — The Club View
- [ ] Read-only dashboard for secretaries
- [ ] Who's coming, when, how many, verified, cover in force
- [ ] Club sets its own monthly cap

*Converts the one thing that could shut this down into the thing that
spreads it.*

## P6 — Club-side release
- [ ] club_releases — weekday, window, min tier, weekly cap
- [ ] Invisible to the public, still routed through a member

*Every network here is member-pull. Nobody has built club-push.*

## P7 — Inter-club matchplay
- [ ] Fixtures, teams, foursomes, order of merit
- [ ] Fixture group threads

*The structural fix for the hosting problem. A fixture gives a reason
to host that has nothing to do with goodwill.*

## P8 — The Archive
- [ ] Every round: course, host, date, conditions, score
- [ ] Season summaries

*Nothing for acquisition, everything for year-three churn.*

## P9 — The Access Index
- [ ] Requests per place filled, per course
- [ ] Annual published ranking from revealed demand, not a panel

*Golf media covers it every year for nothing.*

## P10 — The Diary
- [ ] Member days and a network Open
- [ ] Ballot among members in good standing

## P11 — Sponsorship into membership
- [ ] Discreet layer where a club reviews candidates with a verified
      record
- [ ] Introductions only, at the club's initiative, never a fee tied
      to outcome

*Highest value, highest care. Done wrong it looks like selling
memberships and it's fatal.*

## P12 — Winter Mode
> The season runs April to October. Five months where the core loop has
> nothing to do — and that's exactly when subscription churn happens.

If the home screen in January is an empty Book, members drift off right
before renewal. The app should visibly change in the off-season:

- [ ] Matchplay results and order of merit take the top of the home
      screen
- [ ] Next season's trip planning surfaced
- [ ] The Archive — last season's rounds, best score, courses added
- [ ] The Access Index published (November)
- [ ] Ballot for member days opens
- [ ] Club maintenance calendars for the coming season

*Designed empty states, never a blank Book with a spinner.*

---

## Integrations

| Service | Purpose | Notes |
|---|---|---|
| Supabase | Postgres, Auth, RLS, Storage | EU-Ireland. Session pooler, port 5432 |
| Open-Meteo | Wind speed, direction, gusts | Free, no key. Cache 30 min per course |
| Met Éireann / Met Office | Weather fallback | Only if coverage gaps appear |
| Stripe Billing | Annual membership | Deferred until charging |
| Stripe Identity | Document verification | Store the result, never the document |
| Resend | Transactional email | Domain warming ~3 weeks before launch |
| Broker (TBC) | Group liability cover | One cert ref per member per year. Never split the premium as revenue |
| WHS | Handicap index | No open API across these islands. Manual at launch: member enters, secretary confirms, annual re-check |
| Sentry | Errors | Free tier |
| Metabase | Ops dashboard | SQL views only |

---

## Things That Will Bite You
> Add to this list whenever something bites.

- **Transaction pooler** — port 6543 breaks prepared statements.
  Session pooler, 5432, always. (Cost us 20 minutes on day one.)
- **Double-write on confirmation** — both tap confirm in the same
  second. Unique constraint plus idempotency key, tested in parallel.
- **Tee times and DST** — store local time and club timezone.
- **RLS holes on join tables** — policies on requests are easy,
  request_targets is where it leaks.
- **Email deliverability** — invitations in spam is a silent total
  failure of the invite-only model.
- **Members with two clubs** — tier is the max, requests need a
  "playing as" selector, ledger needs to know which club they hosted at.
- **Deleting a member** — soft delete and anonymise. Ledger and rounds
  must survive or every counterparty's history breaks.
- **Blind release failing quietly** — queue with retries. A cron that
  silently stops is invisible for months.
- **TRUNCATE bypasses row triggers.** Append-only needs a
  statement-level guard as well as the row-level one.
- **Functions with mutable search_path** — Supabase's linter flags
  them and it's a real injection surface. Always SET search_path.
- **Grants and policies are independent locks.** A table can have
  correct policies and still be open if anon holds a grant. Check
  information_schema.role_table_grants for anon after any schema change.
- **SECURITY DEFINER bypasses the policy you just wrote.** Any such
  function must authorise the caller itself, or it becomes the hole in
  the wall. member_balance raises unless you ask for your own balance
  or are an admin.
- **New auth users have no profile row.** A trigger on auth.users
  provisions it. Without that, is_onboarding() is false and signup dies
  at step two.
- **RLS policies that query their own table recurse.** An EXISTS
  subquery against the same table re-enters the policy — Postgres
  errors 42P17. Move the check into a SECURITY DEFINER helper in the
  private schema. Hit this on round_participants and thread_members.
- **A test that only checks `error !== null` treats a crash as a pass.**
  Assert the error code. 42501 is a policy denial; 42P17 is a broken
  policy, and reads as success to a naive check.
- **drizzle-kit's spinner swallows migration errors.** A failed
  db:migrate can look like it hung or succeeded. If a migration seems
  not to have applied, run the SQL directly to see the real error.
- **A shared PRNG plus a short-circuit desyncs every later iteration.**
  `if (!alreadyDone && rand() < 0.3)` skips the draw when the first
  condition is false, shifting the whole sequence and making a "seeded,
  reproducible" test drift between runs. Draw first, then decide.
- **The append-only trigger can be disabled by a superuser.** ALTER
  TABLE ... DISABLE TRIGGER is a legitimate one-time DBA operation but
  must never appear in a code path. Ledger immutability protects against
  application bugs and API access, not against the service role.
- **A keyset cursor on a timestamptz column needs capped precision.**
  Postgres stores microseconds; a JS Date round-trips at millisecond
  precision. Send a truncated cursor value back for an exact-equality
  tiebreak and it silently matches nothing — every page past the first
  comes back empty. `timestamp(3)` on any column used as a cursor.
- **CREATE OR REPLACE can't add a parameter to a zero-arg function.**
  Different argument lists are different overloads to Postgres, not a
  replacement — the old zero-arg version keeps running its old body
  untouched. To parameterise an existing RLS-helper-style function
  without duplicating its formula, make the new signature the source of
  truth and have the old one delegate to it in one line.
- **A batch job that scans a whole table will see other suites'
  fixtures.** expireRequests has no reason to scope itself to "just this
  test's rows" — that's the point of a batch job — so a test asserting
  an exact global count breaks the moment another suite's ephemeral
  fixtures are sitting in the same shared dev database. Assert on the
  specific rows under test, not the aggregate count.
- **Never grep compiler or test output to make it look clean.** A filter
  that hides line one of a multi-line error leaves line two orphaned and
  the summary reading "no errors". Suppress at source or fix it.
- **A new test directory silently doesn't run.** vitest.config.ts has an
  explicit include list; a suite missing from it reports zero tests, not
  an error, and the summary just looks smaller. Caught this on
  tests/availability — 26 tests invisible. Check the file count in the
  summary, not just the pass count.

---

## Metrics

- **Host ratio** — % of members who hosted a stranger in the trailing
  12 months. **Below 30% the network is dying regardless of revenue.**
  Every post-launch phase exists to hold this up.
- **Request fill rate** — share receiving at least one genuine offer
- **Time to first offer** — target 48h. A week feels like being ignored.
- **Ledger balance distribution** — watch the debit tail
- **Month-12 renewal rate**

Ignore: signups, page views, waitlist size. All can look excellent
while the network quietly fails.

---

## Open Decisions

- [ ] Name, cleared and registered
- [ ] Company jurisdiction — NI/UK or Ireland
- [ ] Equity split and Nicholl's ongoing obligation once the network
      exists
- [ ] Are tier rules hard blocks or soft warnings?
- [ ] Founding membership price point

---

## Not Building
> As important as the build list.

- **Native apps** — PWA until there's revenue
- **Commission on green fees** — the thing that ends the business
- **Double-blind / anonymous matching** — the entire basis for hosting
  is knowing who you are
- **Public star ratings** — defamation surface, deeply un-clubbable
- **Caddie booking** — separate marketplace, own cold-start problem
- **Business networking angle** — makes it transactional and cheap to
  exactly the members you need
- **Open messaging or a browsable directory** — fastest way to lose
  Tier I members
- **Geographic expansion** — Scotland, then Europe, then US, and only
  once Irish depth is unarguable

---

## Competitors

| Name | Model | Notes |
|---|---|---|
| Thousand Greens | Peer-to-peer, tiered | Closest analogue. Free/low cost, ~9 years in, UK + US |
| Reciprocal.golf | Credit currency | Host to earn, spend to visit |
| Eligo Club | Paid society, concierge | 100+ courses Europe + US, regional caps ~200. Already in Ireland |
| Outpost Club | Invitation-only society | US, 750+ members, 70+ events/yr |
| Boxgroove | Marketplace | Claims 1,000+ private courses |
| Members Only Network | Vetted P2P | Verifies home club |
| Links2Golf / IAC | Club-to-club B2B | Sold to clubs, not golfers |
| Eden / Eighty / NewClub | Societies | Fellowship + access |

**The gap:** none own Irish and British links depth, none handle the
week rather than the round, none have made clubs participants.

---

## Long-Term

- The definitive access layer for links golf in these islands
- The Access Index as an annual institution with a public voice
- Clubs recommending it rather than tolerating it
- A network still running in twenty years, because it optimised for
  survival rather than extraction

---

## Glossary
> Use these words exactly. Domain language drift is how a schema ends
> up with three names for one thing.

| Term | Meaning |
|---|---|
| **The Book** | The feed of open requests. Not "the marketplace", not "the feed" |
| **Request** | A member saying where he's travelling and when. Trip-shaped, names several clubs |
| **Offer** | A host responding to a request with a specific club, course and tee time |
| **Round** | An offer that was accepted and played. Created on acceptance, settled on mutual confirmation |
| **Host / Guest** | Roles on a round. A member is a host at his own club, a guest elsewhere |
| **The Ledger** | Double-entry record. Hosting credits, being hosted debits |
| **Standing** | Derived from ledger balance plus released feedback. Good, or Under review. Never a score |
| **Tier** | 1–4, world/national/regional/local. You may request within your tier or below |
| **The Form** | A club's dress code, phones, trolleys, caddies, after-golf customs. The most useful screen in the app |
| **The Card** | The pinned summary at the top of a round thread — tee time, wind, dress, caddie fee, host's number |
| **The Quiet Word** | Private channel for reporting something serious. Never scored, never aggregated, goes to admin |
| **Marks** | Unattributed positive tags after a round: kept up, knew the form, good company, straight with arrangements |
| **The Passport** | Verified record of courses played, stamped by the host |
| **Games** | Short-notice fourballs. Nothing to do with access |
| **The Diary** | Curated member days and the network Open, filled by ballot |
| **The Access Index** | Annual ranking derived from requests per place filled |
| **Cover** | Group third-party liability insurance, included in membership |
| **Discretion mode** | Member sees the Book; the Book doesn't see him. No directory listing |
| **Endorsement** | A proposer or seconder vouching for an applicant |
| **Invitation chain** | Who proposed whom, traceable to the founding circle |
| **Availability** | A host's standing declaration of when he'll take visitors. Matched automatically |
| **The Introduction** | Auto-posted first message in a round thread — who the guest is |
| **Graceful decline** | One-tap no, optionally redirected to another date or member |
| **Plus-one** | A non-member brought by a member. The member carries both debits |
| **Domain event** | A recorded fact other parts of the system react to |

---

## Product Constraints
> The audience, stated plainly, because it should constrain every
> design decision.

The typical member is 55–70, wealthy, traditional, sceptical of apps,
and will most often open this on a phone in a links car park with one
bar of signal.

- **Magic links, never passwords.** They will lose a password and they
  will not use a password manager.
- **Large tap targets, high contrast.** Assume reading glasses are in
  the car.
- **No jargon, no cleverness in copy.** "Offer to host", never
  "Connect".
- **Reads must tolerate bad signal.** Cache the Card and the Form so a
  member arriving at a strange club can still see the dress code with
  no reception.
- **Every screen survives a first-time user with no onboarding.** If it
  needs a tour, it's wrong.
- **Nothing may look like a startup.** Restraint is the credibility
  signal for this audience.

---

## Runbook
> How to pick this up cold.

```bash
pnpm dev              # dev server, localhost:3000
pnpm db:generate      # generate migration from schema.ts
pnpm db:migrate       # apply migrations
pnpm db:studio        # browse the database
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

**Environment** — `.env.local`, never committed. Four variables:
`DATABASE_URL` (session pooler, port 5432),
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(dashboard labels this "publishable"), `SUPABASE_SERVICE_ROLE_KEY`.
`.env.example` documents all four.

**Where things live**
```
src/app          routes
src/db           schema.ts, index.ts, migrations/
src/lib          shared utilities, env.ts
CLAUDE.md        conventions and domain rules
ROADMAP.md       this file — project state, source of truth
```

**Branching** — one branch per milestone, Vercel preview deploy per
branch, merge when green. Commit ROADMAP.md updates alongside the work
they describe.

---

## Data Model Quick Reference

| Table | Purpose |
|---|---|
| `profiles` | Member record, extends auth.users |
| `clubs` | Club, tier, region, consent status, guest fee |
| `club_courses` | A club has many courses. Holds out/in bearings for the wind line |
| `memberships` | User ↔ club, with three-state verification |
| `verifications` | Audit of each check: identity, club, handicap, cover |
| `handicaps` | Index, source, locked against hand-editing |
| `invitations` | Codes, issuer, expiry, redemption |
| `applications` | Joining state machine |
| `endorsements` | Proposer and seconder |
| `requests` | Where a member wants to play, and when |
| `request_targets` | Clubs a request names |
| `offers` | A host's response, with course and tee time |
| `rounds` | An accepted offer, with both confirmations |
| `round_participants` | Who played, in what role |
| `ledger_entries` | Append-only. The governance model |
| `threads` / `thread_members` / `messages` | Correspondence |
| `feedback` | Would-again plus marks, blind released |
| `reports` | The quiet word. Never scored |
| `club_content` | The form guide |
| `club_events` | Maintenance, closures, competitions, news |
| `club_releases` | Club-side quiet availability (P6) |
| `audit_log` | Every admin action |
| `domain_events` | Emitted events, processed separately. Replayable |
| `host_availability` | A host's declared windows — weekday, capacity, min tier |
| `host_declines` | A host's one-tap no on a request he never offered on, with an optional redirect |
| `feature_flags` | Per-key, optionally scoped |

---

## Testing Strategy
> Two-person team. A test suite you resent is a test suite you skip.

- **Heavy on the ledger, no exceptions.** Unit and property tests.
  Balance always equals the sum of entries.
- **Two Playwright journeys only:** application end to end, and
  request → offer → confirm → ledger.
- **The hostile member RLS suite is permanent.** It never gets deleted,
  and it grows a case every time a table is added.
- Everything else gets light coverage.

---

## Architecture Decisions

### Domain events, not scattered side-effects

A confirmed round must write the ledger, stamp the Passport, open the
return-leg prompt, notify both sides and trigger feedback. If those live
inside the confirm handler it becomes a monster and every new feature
edits it.

Emit to `domain_events`, handle subscribers separately, mark processed.
With a two-person team this is the difference between a codebase you can
still reason about at M9 and one you can't — and it makes replay
possible when something fails silently.

Events emitted as of M4c (src/lib/requests.ts, src/lib/offers.ts,
src/lib/ledger.ts, src/lib/availability.ts): `request.created` ·
`request.withdrawn` · `request.filled` · `request.expired` ·
`request.declined_by_host` · `offer.made` · `offer.withdrawn` ·
`offer.rejected` · `offer.accepted` · `round.created` ·
`round.confirmed` · `round.settled` · `round.cancelled` ·
`round.reversed` · `availability.declared`. Named `offer.rejected`, not
`offer.declined` as originally planned here — the requester declining a
specific offer, distinct from a request lapsing unfilled, and distinct
again from `request.declined_by_host`, which is a host declining a
request he never offered on. Still to come: `application.approved` ·
`feedback.released` · `membership.lapsed`.

### Availability inverts the pull

Member-pull alone puts the work on the wrong side and caps fill rate —
it assumes hosts are watching the Book. They aren't.

A host declares a window once ("Tuesdays and Thursdays in October, two
places, Tier I and II"), matching runs automatically, and he hears from
us only when something fits. This is the biggest single lever on
time-to-first-offer.

### Silence is the worst outcome

An expiring offer reads as a snub. In a network built on courtesy that's
corrosive. Every request must be closable with a graceful no, ideally a
redirected one. A redirected no is worth more than a slow yes.

### Snapshot, don't reference

Dress codes and guest fees change. A Card from 2027 must show what was
true in 2027. Copy the relevant `club_content` fields onto the round at
confirmation — two minutes of work, and it's what makes the Archive
trustworthy years later.

### Cancellation is a decided path, not a hotfix

A confirmed round can still fall through — illness, flooding — after the
ledger has moved. The reversal is a compensating entry with a reason.
Never a delete. Decide it now, not in a panic.

---

See P12 — Winter Mode.

---

## Unfilled Requests Are the Asset
> A request that expires with no offer is not a failure to discard.

It is simultaneously:

- **The Access Index.** Requests per place filled *is* the ranking
- **The trigger for club-side release.** Demand evidence a secretary
  can act on
- **The most persuasive thing you can say to a club.** "Fourteen members
  asked for your course in October. We filled one."
- **Your own early warning.** A rising unfilled rate means supply is
  failing before the host ratio shows it

Retain every one. The row already exists; keeping it costs nothing.

---

## Seed Data Is Real Data

Do not generate fake clubs. The seed script should load the actual
~150-club reference list — names, tiers, regions, coordinates, bearings,
guest fees — from a checked-in CSV or JSON under `src/db/seed/`.

Dev and production then share one source of truth, and the C1/C2 content
work and the seed script become the same job rather than two.

Members and rounds stay synthetic. Clubs are real from day one.

---

## Small Things That Punch Above Their Weight

- **The introduction** — auto-posted first message in every round
  thread. Removes the awkwardness from the moment that matters most.
- **Pace of play** — nobody asks and everyone cares. A slow guest is the
  most common reason a host doesn't repeat. Field on profile and
  request.
- **Plus-ones** — a member will bring a non-member friend. Model it, and
  decide the ledger rule: the member carries both debits.
- **ICS feed** — this audience lives in Outlook. A few lines of code
  puts the product where they actually look.

---

# Content Workstream
> Parallel to the build. Not code, and it decides launch quality more
> than any feature does.

## C1 — Club list and tiering
- [ ] ~150 launch clubs identified
- [ ] Tier assigned 1–4 for each (Nicholl's judgement, not a ranking
      panel)
- [ ] Access difficulty 1–4
- [ ] Region, coordinates, timezone

## C2 — Course bearings
- [ ] Out and in bearing recorded for every course

*Nobody costs this and it's real work — satellite imagery, per course.
It's what makes "out into it, home downwind" possible, and that line is
the detail members will talk about.*

## C3 — The Form
- [ ] Dress on course, dress in clubhouse, phones, trolleys, caddies
      and fee, after-golf, guest fee — per club

*~150 clubs × 30 minutes ≈ 75 hours. Cannot be scraped reliably. A
wrong dress code is worse than no dress code. Needs the M8 club content
editor to be delegable.*

## C4 — Maintenance calendars
- [ ] Hollow-coring, aeration, closures for the coming season

*No central source exists anywhere. One email to every secretary each
February, then the Club View (P5) maintains it.*

---

## Decision Log
> Dated, with reasons. Prevents re-litigating.

**2026-07-31 — A window's min_tier is a floor read in the opposite
direction from the club-tier check.** request_targets' RLS policy and
requests.ts's tier check both use `club.tier >= my_tier` — "I may
request into my tier or a worse one." host_availability.min_tier is the
opposite shape: a host declaring `min_tier: 2` wants only his tier or
better, so matchRequestToAvailability and matchAvailabilityToRequests
(src/lib/availability.ts) test `requesterTier <= minTier`, not `>=`.
Both read the same in prose ("at or above the standard") because lower
tier numbers are more prestigious; the comparator flips because one
question is "is this club worthy of me" and the other is "is this
requester worthy of my window." Documented in availability.ts's
tierAllows so the asymmetry isn't mistaken for a bug and "fixed" into
matching the request_targets direction.

**2026-07-31 — matchRequestToAvailability and matchAvailabilityToRequests
are read-only by design.** Neither creates an offer — a host still has
to choose to make one. The comment in availability.ts says so explicitly
because the whole point of automatic matching (see "Availability inverts
the pull" above) is surfacing the request to the right host, never
committing him. A future UI that auto-drafts an offer from a match would
be building past this deliberately.

**2026-07-31 — declineToHost and matchRequestToAvailability share one
exclusion vocabulary: a live offer or a decline row.** Both read
TERMINAL_OFFER_STATES from offers.ts rather than each service keeping
its own list of "not really live" offer states — the two exclusions
(host already offered, host already declined) are the same rule
`matchRequestToAvailability` enforces to decide who gets surfaced, so
declineToHost's "a host with a live offer must withdraw, not decline"
check (HAS_LIVE_OFFER) uses the identical state list.

**2026-07-31 — A weekday window's matching dates are computed with an
ISO-0-is-Monday formula, independently re-derived in the test harness.**
host_availability.weekday is documented as "0-6, ISO (0 = Monday)", which
doesn't match JS's native Date.getUTCDay() (0 = Sunday). availability.ts
converts via `(jsDay + 6) % 7`; tests/availability/harness.ts's
isoWeekdayOf reimplements the same formula independently (checked against
Python's `date.isoweekday() - 1` while writing it) rather than importing
availability.ts's version, so the weekday-window test isn't just checking
the implementation against itself.

**2026-07-31 — Hosting is never gated on standing.** createRequest
checks standing (src/lib/requests.ts); makeOffer deliberately does not
(src/lib/offers.ts). A member deep in debit should be encouraged to
host — that's how his balance recovers — not locked out of the one
action that fixes it. Asymmetric on purpose; don't "fix" it into
symmetry with createRequest.

**2026-07-31 — One accepted offer does not fill a request.** A request
is trip-shaped and may name several clubs, so a member may accept
several offers against one request — request.state stays 'open' through
acceptOffer. The requester closes it explicitly via fillRequest, or
expireRequests closes it for him (as 'filled', see below) once at least
one offer was accepted.

**2026-07-31 — expireRequests fills instead of expiring when an offer
was accepted.** A request whose window lapses after a host and guest
already committed to a round did its job; marking it 'expired' would
misrepresent it in the Access Index as unfilled demand. Checked via
offers.state = 'accepted', not "has any offer" — an offer that was
merely made and later withdrawn or declined still expires normally.
Emits request.filled (payload.viaExpiry: true) rather than
request.expired.

**2026-07-31 — A cancelled round's played_on date is read back via a
SQL ::date cast, not a JS Date's UTC getters.** offers.tee_at_local is
"timestamp without time zone" — Postgres stores the literal wall-clock
digits with no offset. Deriving round.played_on from a JS Date object
built from that column risks a date shift near midnight depending on
the server process's system timezone (date-time strings without an
offset parse as local time in JS, but postgres-js formats Date values
for a non-tz column using UTC getters). `select tee_at_local::date`
sidesteps the round-trip entirely and reads back exactly what's stored.

**2026-07-31 — rounds.cancelledAt is distinct from reversedAt.**
cancelRound can fire before or after settlement — offers.ts calls
reverseRound (setting reversedAt) only if settledAt was already set when
cancellation happens; either way cancelledAt/cancelReason record that
this round was cancelled and why. A round can therefore be reversed
without being cancelled (a correction) or cancelled without ever having
been reversed (cancelled pre-settlement) — the two timestamps answer
different questions and neither implies the other.

**2026-07-31 — The live-offer-per-host constraint is a partial unique
index, not a plain one.** offers_request_id_host_id_live_unique
(migration 0015) covers (request_id, host_id) only where state is not
in ('withdrawn','declined','expired','cancelled') — a host may re-offer
on the same request after withdrawing or being declined, so only one
row may be live at a time, not one ever. Backs makeOffer's
DUPLICATE_LIVE_OFFER application check as a real DB constraint, per
CLAUDE.md's "database constraints enforce invariants, not application
code."

**2026-07-30 — RLS test fixtures use permanent fixed identities.**
ledger_entries is append-only, so any fixture that touches the ledger
can never be deleted. Rather than accumulate orphans every run, the
ledger-linked chain (one member, one admin, two clubs, one round, two
entries) is find-or-create on a stable key and stays permanently.
Everything else uses a per-run prefix and is torn down. Fixture rows are
named @rls-fixture.invalid and "ZZ RLS Fixture — " so they are
unmistakable, and the seed script must exclude them.

**2026-07-29 — Membership fee, never commission on green fees.**
Taking a cut of a guest fee is brokering tee times. It's what gets a
member hauled in front of his committee and the platform a
cease-and-desist. This is why the strongest incumbent is free.

**2026-07-29 — Ledger as governance, not a committee.**
Balance falls, network quietly closes, member hosts, it opens again.
No reporting, no awkward conversations, self-enforcing.

**2026-07-29 — Unattributed, not anonymous.**
In a network this size a member can often work out who rated him.
Promising anonymity and being caught out is worse than never promising
it. The UI says "not attributed" and means it.

**2026-07-29 — Depth in Ireland and Britain over global breadth.**
Every competitor is broad and shallow. Cold-start is solved by depth.
A Californian founder cannot replicate Nicholl's relationships by
emailing secretaries.

**2026-07-29 — Trips via a licensed partner operator, introducer only.**
Selling golf plus accommodation makes you a package organiser, with
bonding and licensing obligations. Referral fee instead, customer
contracts with the operator.

**2026-07-29 — A club is not a course.**
Portrush has the Dunluce and the Valley. Modelling this late would make
every round, stamp and ledger entry ambiguous.

**2026-07-29 — PWA, not native.**
App Store review and two codebases would eat months before there is any
revenue to justify them.

**2026-07-29 — Supabase EU-Ireland, Drizzle, Next 16, magic link auth.**
RLS is the entire security model. Ireland keeps data in the EU and
close to members.

**2026-07-29 — Plus-ones: the member carries both debits.**
A member bringing a non-member friend takes two debits, not one. Keeps
the reciprocity incentive honest — otherwise a member could consume
double the hosting while owing single.

**2026-07-29 — Cancellation reverses, never deletes.**
A confirmed round that falls through gets a compensating ledger entry
with a reason. The original row stays. Preserves the append-only
invariant and leaves an auditable trail.

**2026-07-29 — Design reference lives in /design.**
Two HTML prototypes — the app and the landing page — are the visual
spec for M4–M7. Honours board, not startup. Update them when the
direction changes rather than letting the direction live only in chat.

**2026-07-29 — Cancelled rounds are terminal.**
A cancelled round is reversed with a compensating entry and never
re-confirmed. If the round happens after all, it is a new round. This
keeps UNIQUE (round_id, user_id, direction) intact and leaves an
honest audit trail of what was cancelled and what was rearranged.

**2026-07-29 — Ledger amounts are always positive.**
Direction carries the sign. A CHECK enforces amount > 0, closing the
route where a negative credit acts as a debit without breaching the
append-only rule.

**2026-07-30 — profiles.display_name and initials are nullable until
member.** Magic-link signup knows only an email, so the provisioning
trigger cannot supply a name. Nulls mean "not yet known" rather than a
placeholder like 'Member', which would look like real data wherever it
surfaced. A CHECK constraint enforces that both are present by the time
status reaches 'member'.

**2026-07-30 — The ledger threshold locks requests, via a grace band.**
Balance >= 0 is 'good'. -1 or -2 is 'owing' but canRequest stays true —
the grace band exists so a member hosted exactly once isn't immediately
locked out over one unsettled round. Balance <= -3 is 'closed' and
canRequest goes false: a hard lock, not a soft flag, because a flag a
member can route around isn't governance, it's a suggestion. Standing is
ledger-derived only for now; M7 folds in released feedback.

**2026-07-30 — Plus-one amount: host is credited per head, the inviting
member is debited per head.** Settling a round credits the host once for
every guest who played, member or plus-one alike — he hosted four
people, he's credited four. Each guest member is debited 1 for himself
plus 1 for every plus-one attributed to him via
round_participants.invited_by. A plus-one row generates no ledger entry
of its own; it's already counted in its inviter's debit. This is the
precise mechanics behind the 2026-07-29 "member carries both debits"
decision — credits and debits always sum to the same total per round,
so the reciprocity incentive can't be gamed by bringing a friend along.

**2026-07-30 — Property tests roll back; scenario tests persist.**
The append-only ledger means test writes are permanent, so the
100-iteration property test runs inside a transaction that is rolled
back — zero permanent footprint, and the idempotency bookkeeping it
needed disappears with it. Scenario tests keep a small fixed set of
permanent fixture rounds as a deliberate audit trail.

---

## Changelog
> Newest first. One entry per milestone completed.

**2026-07-31 — M4c complete (host availability matching and graceful
decline). M4's service layer is done.** New service (src/lib/
availability.ts): declareAvailability, updateAvailability,
deactivateAvailability, matchRequestToAvailability,
matchAvailabilityToRequests — no UI, no routes. An AvailabilityError
class covers VALIDATION_FAILED (including the readable Zod message for
"neither weekday nor a bounded range" rather than a raw 23514 from the
host_availability_window_check constraint), NO_CONFIRMED_MEMBERSHIP,
COURSE_CLUB_MISMATCH, AVAILABILITY_NOT_FOUND, NOT_OWNER and
REQUEST_NOT_FOUND. Both match functions are read-only by design (decision
above) and share exclusion logic — no live offer, no decline row, not the
requester's own window, capacity, min_tier, window overlap — reusing
TERMINAL_OFFER_STATES exported from offers.ts rather than redefining it.
offers.ts gained declineToHost: a host's one-tap no on a request he
never offered on, distinct from rejectOffer (the requester turning down
an offer that exists). Idempotent per (host, request) via
host_declines_request_id_host_id_unique; refuses a host with a live offer
(HAS_LIVE_OFFER — he should withdraw instead) and a suggested member who
isn't a real member (SUGGESTED_MEMBER_NOT_FOUND). Emits
`request.declined_by_host` with the reason and any redirect.
Migration 0016 adds host_declines (schema-tracked via schema.ts,
drizzle-kit generate) plus its RLS by hand in the same file, following
CLAUDE.md's convention for hand-managed policies: SELECT for the
declining host or the request owner, INSERT for the host only. Tests
(tests/availability/, added to vitest.config.ts's include list — a new
test directory doesn't run until it's listed there) use the same
rollback-transaction pattern as tests/offers and tests/requests, plus an
independently re-derived ISO-weekday formula in the harness (decision
above) so the weekday-matching test isn't circular. 188 passing, 0
skipped across the full suite. The M4 Playwright journey test remains
open — noted at the top of this file, not swept under this entry — since
it needs UI/routes that M4 deliberately built none of.

**2026-07-31 — M4b complete (offer lifecycle and mutual confirmation).**
Offer service (src/lib/offers.ts): makeOffer, withdrawOffer,
rejectOffer, acceptOffer, fillRequest, confirmRound, cancelRound — no
UI, no routes. An OfferError class with a discriminated code covers
every precondition (REQUEST_NOT_OPEN, OWN_REQUEST,
NO_CONFIRMED_MEMBERSHIP, COURSE_CLUB_MISMATCH, CLUB_NOT_TARGETED,
DUPLICATE_LIVE_OFFER, NOT_HOST, NOT_OFFERED, NOT_OWNER, NOT_PARTICIPANT,
ROUND_IN_FUTURE, ROUND_CANCELLED, and the not-found variants).
makeOffer deliberately skips the standing check createRequest has —
decision above. acceptOffer is where thread creation lives, per the
domain rule that a thread may only come from an accepted offer, an
itinerary, or a fixture: it builds the round, round_participants (host,
requester, and one row per plus-one with invited_by set), the thread,
and thread_members for the host and requester only — plus-ones get no
thread access. confirmRound sets host_confirmed_at or guest_confirmed_at
per side, refuses a round whose played_on is still in the future, and
calls ledger.ts's settleRound in the same transaction once both sides
are in; idempotent per side, matching settleRound's own idempotency.
cancelRound is the decided path from the M3 decision log: reverses via
ledger.ts's reverseRound if the round was already settled, otherwise
touches no ledger row at all, and marks the round terminal
(cancelled_at/cancel_reason, migration 0015) so it can never be
confirmed or re-settled afterward — offers.ts enforces this by checking
cancelled_at before confirmRound does anything else. expireRequests
(src/lib/requests.ts) now closes a request as 'filled' rather than
'expired' when it has an accepted offer, so a committed round isn't
misrepresented as unfilled demand in the Access Index; ExpireRequestsResult
gained a filledCount field alongside expiredCount/unfilledCount.
Migration 0015 also adds a partial unique index
(offers_request_id_host_id_live_unique) backing the "one live offer per
host per request" rule as a real constraint, not just an application
check. Tests (tests/offers/) use the same rollback-transaction pattern
as tests/requests — including the confirm/settle and cancel/reverse
paths, since ROLLBACK is transaction control and never trips the
ledger's append-only trigger. 160 passing, 0 skipped across the full
suite.

**2026-07-30 — M4a complete (request creation and the Book query).**
Request service (src/lib/requests.ts): createRequest, withdrawRequest,
expireRequests, listBook, myRequests — no UI, no routes, no offers yet.
Zod validates at the boundary (dates, party size, target club count);
a RequestError class with a discriminated code covers the rest
(STANDING_CLOSED via ledger.ts's standing(), NO_CONFIRMED_MEMBERSHIP,
CLUB_TIER_TOO_HIGH, NOT_OWNER, REQUEST_NOT_FOUND). The tier check
reuses private.my_tier(uuid) rather than re-deriving the RLS policy's
comparison — that function only ever took auth.uid() implicitly before
this, so it's now parameterised (migration 0013), with the old zero-arg
form reduced to a one-line delegation so there's one formula, not two.
listBook's keyset cursor uncovered a real bug: Postgres's microsecond
timestamptz precision doesn't round-trip through a JS Date parameter,
so an exact-equality tiebreak silently matched nothing past page one —
fixed by capping requests.created_at to millisecond precision
(migration 0014). Tests (tests/requests/) use the rollback-transaction
pattern throughout, same as the ledger property test: nothing here
writes to ledger_entries, so nothing needs to survive. 139 passing,
0 skipped across the full suite.

**2026-07-30 — M3 complete.** Ledger service (src/lib/ledger.ts):
settleRound, reverseRound, memberBalance, standing, all transaction-
scoped, all server-side only. round_participants.invited_by added
(migration 0011) so a plus-one's debit is attributable to the member who
brought him; round_participants' SELECT policy needed no change since it
was already rewritten (0008) to gate on round_id/is_admin, never on the
row's own user_id. settleRound and reverseRound are idempotent by
design — a repeat call, or the loser of a concurrent confirm race,
resolves via a SELECT ... FOR UPDATE row lock to a no-op rather than an
error or a duplicate; a reversed round is terminal and raises if
re-settled. 128 passing, 0 skipped: unit tests for every amount
scenario (plain, multi-guest, plus-one, multi-guest-with-plus-ones),
settle-twice and reverse-twice no-ops, the reversed-cannot-resettle
error, all six standing boundaries, a real two-connection concurrency
race, and a seeded 100-iteration property test asserting
memberBalance() always equals the raw sum of ledger_entries. Tests use
the postgres connection directly, never RLS, matching how the ledger
itself runs in production.

**2026-07-30 — M2 complete.** Hostile-member RLS suite: 93 passing,
1 skipped (domain_events, not yet created). Verified against a real
authenticated session through supabase-js, not the postgres role.
Covers anon reaching zero tables with the list derived at runtime,
ledger isolation, member_balance authorisation, blind feedback release,
thread and round membership, tier enforcement including the fail-closed
unconfirmed case, applicant scope, and a coverage guard asserting every
public table has RLS and no anon grants. Fixed 42P17 recursion on
round_participants and thread_members via SECURITY DEFINER helpers
(migration 0008).

**2026-07-30 — M1 gap closed (Prompt F tables).** domain_events and
host_availability created; round_participants now supports non-member
plus-ones (nullable user_id, guest_name, is_member, surrogate uuid pk,
partial unique index on (round_id, user_id) WHERE user_id IS NOT NULL);
rounds carries snapshotted form fields; profiles and requests both got
pace_preference. Schema and column changes via drizzle-kit generate
(migration 0009), RLS by hand (migration 0010) — host_availability
gated on ownership plus a club_confirmed membership check for INSERT,
domain_events service-role-only like audit_log. Confirmed
round_participants' SELECT policy (rewritten in 0008) never reads the
row's own user_id, so a plus-one's null user_id doesn't change who can
see it — no policy change needed there. 110 passing, 0 skipped.

**2026-07-30 — M2a complete.** RLS applied across all 24 public tables,
44 policies, anon granted nothing anywhere. Five private.* helper
functions outside the API surface. member_balance is SECURITY DEFINER
and self-authorising. Tier enforcement lives in the request_targets
INSERT policy, blind release in the feedback SELECT policy, and the
no-thread-from-profile rule is enforced by granting SELECT only.
Profiles are provisioned by a trigger on auth.users, so profiles needs
no INSERT policy. Verified: zero anon grants, all tables RLS-enabled,
audit_log deny-all.

**2026-07-29 — M1 complete.** Domain schema applied: 24 tables, 15
enums, all FK indexes, check constraints on club tiers and course
bearings. Ledger hardened — append-only trigger, TRUNCATE guard,
amount > 0 check, member_balance() with pinned search_path.
Verified in the database: two triggers present, six constraints on
ledger_entries, member_balance returns 0, and an attempted negative
credit was rejected by the check constraint ahead of the foreign key.

**2026-07-29 — M0 partial.** Scaffold complete: Next 16, TypeScript
strict, Tailwind, Drizzle, Supabase EU-Ireland, Zod env validation,
ESLint/Prettier. Repo private and pushed. health_check migration
applied, /api/health green. Session pooler connection verified.
