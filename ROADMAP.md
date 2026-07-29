# The Golfers' Connection — Roadmap
### A private reciprocal access network for members of elite clubs in Ireland and Britain
*Last updated: 29 July 2026*

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

**Now working on.** M2 — identity and RLS.

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
- [ ] RLS policy on every table
- [ ] hostile_member test fixture
- [ ] Automated test: hostile member cannot read the directory, another
      member's ledger, another member's threads, or any table by direct
      PostgREST call

*Join tables are where the leaks are — request_targets, thread_members,
round_participants. Test every one.*

## M3 — The ledger
- [ ] Entry writes, idempotency
- [ ] Balance derivation, standing thresholds
- [ ] Unit tests: double-write, out-of-order confirmation, corrections
- [ ] Property test: balance always equals sum of entries
- [ ] Parallel-request test for the confirm race
- [ ] Cancellation reversal — compensating entry with a reason,
      never a delete. Decided path before it's needed in anger.
- [ ] Plus-one rule: the member carries the debit for his guest too

*The only thing that must be perfect. Everything else is rebuildable in
a weekend.*

## M4 — The Book
- [ ] Request creation, tier filtering, request_targets
- [ ] Offer flow and full state machine
- [ ] Mutual confirmation → ledger write
- [ ] Request expiry job
- [ ] Playwright: request → offer → accept → confirm → ledger entry →
      balance moves
- [ ] Host availability matching — a host declares a window once,
      matching runs automatically, he's nudged only on a fit
- [ ] Graceful decline — one tap: not this time / try me in September /
      ask Jim at Castlerock instead
- [ ] Unfilled request capture — expired-with-no-offer rows retained
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
- [ ] Does the ledger threshold lock requests or just flag them?
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

Events to emit from the start:
`round.confirmed` · `offer.accepted` · `offer.declined` ·
`request.expired` · `application.approved` · `feedback.released` ·
`membership.lapsed`

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

---

## Changelog
> Newest first. One entry per milestone completed.

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
