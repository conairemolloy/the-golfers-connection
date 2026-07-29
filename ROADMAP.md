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
- [ ] Seed script — 40 clubs, 60 members, 200 rounds, populated ledger
- [ ] Sentry wired
- [ ] Vercel preview deploys

*Done when `pnpm seed` gives a database you can develop against.*

## M1 — Domain schema
- [ ] All tables per spec, pgEnums for every enumerated type
- [ ] Ledger immutability trigger (raises on UPDATE/DELETE)
- [ ] member_balance(uuid) SQL function
- [ ] Unique constraints: (round_id, user_id, direction),
      idempotency_key, (round_id, from_user), (user_id, club_id),
      (application_id, role)
- [ ] Indexes on all FKs, plus requests(state, date_from) and
      offers(request_id, state)
- [ ] Drop health_check, point /api/health at `select 1`

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

*The only thing that must be perfect. Everything else is rebuildable in
a weekend.*

## M4 — The Book
- [ ] Request creation, tier filtering, request_targets
- [ ] Offer flow and full state machine
- [ ] Mutual confirmation → ledger write
- [ ] Request expiry job
- [ ] Playwright: request → offer → accept → confirm → ledger entry →
      balance moves

## M5 — Correspondence
- [ ] Threads on accepted offers
- [ ] Messages, read state, mute
- [ ] Round card pinned at top of round thread
- [ ] Trip group threads
- [ ] Test asserting no thread-from-profile code path exists

## M6 — Clubs
- [ ] Club pages, club_content form guide
- [ ] club_events — maintenance, closures, competitions, news
- [ ] Guest fee, member counts, access difficulty
- [ ] Weather via Open-Meteo, 30-min cache per course
- [ ] Wind line derived from out_bearing / in_bearing vs wind direction

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
- [ ] Whether trips are introducer-only from day one (they should be)

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
