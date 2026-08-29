---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments: ['docs/prd.md']
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-08-28'
project_name: 'Fantasy Football Copilot'
user_name: 'Zimrri'
date: '2026-08-28'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
28 FRs across 7 capability areas: League Connection & Sync, Roster & Matchup Analysis,
Waiver Wire Research, Trade Evaluation, News & Injury Monitoring, Weekly Recommendations
& Reporting, and Notifications & Mobile Access, plus a cross-cutting Cost & Data Source
Management group. Architecturally, this reads as: one external read-only integration
(Sleeper), a scheduled multi-agent analysis pipeline (2 agents at MVP, 4 at Growth), a
persistence layer for synced data + generated recommendations + recommendation history,
and a single dashboard-style presentation layer.

**Non-Functional Requirements:**
- *Performance*: recommendations must be pre-computed ahead of real deadlines (waiver
  processing, lineup lock) — this rules out synchronous "compute on page load" designs
  in favor of scheduled batch jobs.
- *Security*: credential hygiene (Sleeper/Supabase/LLM keys) and restricting the
  deployed app from public access once on Vercel — no multi-user auth system needed.
- *Integration Reliability*: every external dependency (Sleeper, free news sources, LLM
  providers) needs a defined fallback/degradation behavior, not just a happy path.
- *Cost Efficiency*: this is the requirement with the widest architectural reach — it
  drives scheduling cadence, model selection strategy, and data-source choice
  throughout the whole system.

**Scale & Complexity:**
- Primary domain: full-stack web app with an AI multi-agent orchestration layer
- Complexity level: Low-medium for a solo/personal project — no multi-tenancy, no
  compliance burden, no scale requirements — but genuine complexity from coordinating
  multiple scheduled agents, multiple external integrations, and a local-then-Vercel
  deployment target
- Estimated architectural components: frontend (SPA dashboard), backend/API layer,
  scheduled job runner (agent orchestration), Supabase data layer, external integration
  clients (Sleeper, news sources, LLM provider(s))

### Technical Constraints & Dependencies

- Must run locally first, with a credible path to Vercel deployment later — favors a
  stack that works well in both environments without a rewrite.
- Sleeper integration is read-only and unauthenticated (public API) — confirmed working
  during PRD discovery.
- No paid data-source tier is acceptable if it alone costs $100+/month — this rules out
  the Twitter/X API. News-source selection landed on Perplexity's Sonar API instead of
  the originally-planned RSS/Reddit (revised during implementation — see Web App
  Specific Requirements): still well under the cost ceiling, and it comes with cited
  sources, which RSS/Reddit parsing wouldn't have given for free.
- LLM access must support flexible, cost-aware model selection (Claude API and/or
  OpenRouter), not a single fixed expensive model for every call.
- Solo builder, AI-assisted — architecture should favor low operational overhead
  (managed services, minimal custom infra) over maximum flexibility.

### Cross-Cutting Concerns Identified

- **Cost control** touches nearly every component: how often agents run, which model
  handles which task, what gets cached vs. recomputed.
- **Reasoning transparency**: FR6, FR12, and FR16 all require recommendations to carry
  visible reasoning, not just a verdict — this needs to be a first-class part of the
  data model (every recommendation stores its "why"), not bolted on in the UI later.
- **Graceful degradation**: every external integration (Sleeper, news sources, LLM
  providers) needs defined fallback behavior per the Integration Reliability NFR.
- **Extensibility for Growth-phase agents**: MVP ships 2 agents, Growth adds 2 more —
  the orchestration approach should accommodate that without a redesign.
- **Local → Vercel portability**: deployment target changes but the architecture
  shouldn't have to.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (Next.js) with a scheduled AI agent orchestration layer,
per the confirmed TypeScript + Next.js + Vercel + Supabase stack.

### Starter Options Considered

- **Official Vercel Next.js + Supabase example** (`with-supabase`) — maintained
  directly in the `vercel/next.js` examples repo, kept current with Next.js releases.
  Sets up cookie-based Supabase Auth, TypeScript, Tailwind CSS, App Router.
- **Third-party SaaS starters** (e.g., `Razikus/supabase-nextjs-template`,
  `utkarshchoubeycs/nextbase`) — more batteries-included (user management, billing
  scaffolding, i18n, mobile app template), but that's scope built for multi-tenant SaaS
  products we don't need and would have to strip back out. Extra surface area to
  understand and maintain for no benefit here.

### Selected Starter: Official `with-supabase` Next.js Example

**Rationale for Selection:**
This is a single-user personal tool, not a SaaS product — we want the smallest correct
foundation, not a pre-built multi-tenant platform. The official example gives us exactly
the pieces the PRD actually needs (TypeScript, Supabase client wiring, basic auth
scaffolding we can repurpose to just gate the one user) without unrelated
billing/team/i18n scaffolding to rip out. It's also the version most likely to stay
aligned with current Next.js/Supabase APIs since Vercel maintains it directly.

**Verified current versions (as of 2026-08-28):**
- Next.js: **16.3.3** — this is a patched release; 16.3.2 shipped Aug 21 with two
  critical-severity vulnerabilities that 16.3.3 (Aug 25) fixes. `create-next-app` pulls
  the latest by default, but worth confirming the installed version isn't pinned to
  16.3.2 or earlier.
- Package manager/runtime: standard Node.js LTS (whatever `create-next-app` requires at
  install time — verify against the current Next.js Node.js compatibility table during
  actual project init, not assumed here).

**Initialization Command:**

```bash
npx create-next-app --example with-supabase fantasy-football-copilot
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
TypeScript, Next.js App Router (React Server Components + Server Actions available —
relevant later for how agent-triggered mutations get wired to the UI).

**Styling Solution:**
Tailwind CSS — no extra decision needed, matches "low ops overhead" priority.

**Build Tooling:**
Next.js's built-in build/dev tooling (Turbopack dev server as of current Next.js) — zero
custom webpack/vite config to maintain.

**Testing Framework:**
None included by default. Added deliberately during implementation: **Vitest**, for
unit-testing pure logic (Zod schema validation, JSON-parsing/validation) without
needing a live Supabase project or LLM API key — `npm test` (`vitest run`). Config at
`vitest.config.ts`. Integration/E2E testing against real Sleeper/Supabase/LLM services
is intentionally out of scope until real credentials exist to test against.

**Code Organization:**
Standard Next.js App Router conventions (`app/` directory, route-colocated
`page.tsx`/`route.ts`), plus a `utils/supabase/` client-setup pattern for
browser/server/proxy Supabase clients — this pattern is exactly what we need for
secure server-side calls to Sleeper/LLM/news APIs (keeping API keys server-only) and
client-side reads of already-computed recommendations.

**Development Experience:**
Standard `next dev` local server — matches "runs locally first" requirement with zero
extra setup; the same codebase deploys to Vercel unchanged.

**Scheduling note (validated against current Vercel limits):** Vercel Hobby (free) plan
now allows up to 100 cron jobs per project, but each cron job is capped at a
once-per-day cadence (exact trigger time guaranteed only within the hour). This lines up
exactly with the PRD's Performance NFR (recommendations pre-computed ahead of
deadlines, not real-time) and the Cost Efficiency NFR (batched, not per-request, LLM
calls) — no paid Vercel plan needed for MVP's scheduling needs.

**Note:** Project initialization using this command should be the first implementation
story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
Database and schema shape (Supabase/Postgres with `reasoning` as first-class data),
auth method (Supabase Auth, email/password — see below), server-only handling of all
secrets, and the Vercel Cron + Route Handler job pattern for scheduled agent runs.

**Important Decisions (Shape Architecture):**
Zod for validating all external payloads, per-integration typed client modules instead
of a generic abstraction layer, RLS scoped to `auth.uid()` on every user-owned table
from day one, and no client-side global state manager. Exception found during schema
design: `players` (the global Sleeper reference cache) is public NFL data, not personal
data — it's RLS-enabled but with an any-authenticated-user `select` policy and no
per-user scoping, since there's nothing user-specific to scope.

**Deferred Decisions (Post-MVP):**
Dedicated observability/error-tracking tooling (Sentry or similar) — Vercel/Supabase's
built-in logs are sufficient for a solo project at MVP; revisit only if agent failures
become hard to diagnose. A formal API layer for external consumers is also deferred —
not needed until/unless a second user or external integration shows up.

### Data Architecture

- **Database:** Supabase (Postgres).
- **Core tables:** `players` (global Sleeper player reference cache — public data,
  not user-scoped, service-role writes only), `leagues`, `rosters`, `roster_players`
  (which players sit on which synced roster), `matchups`, `recommendations` (includes a
  `reasoning` field as first-class data per FR6/FR12/FR16, a `sources` jsonb column
  (`{title, url}[]`, added during implementation for FR6a/FR12a — the Perplexity
  citations) as first-class data alongside it, and a `status` column that serves both
  the weekly view and the history/"followed?" view from FR23 — collapsed from an
  earlier separate `recommendation_history` table during actual schema design, since a
  second table would only duplicate this data), and (Growth phase) `news_events`,
  `trades`.
- **Validation:** Zod (current stable v4, 4.4.3) validates every external payload
  (Sleeper, RSS/news, LLM structured output) before it's written to the database.
- **Migrations:** Supabase CLI, versioned SQL migration files committed to the repo —
  not dashboard-only schema edits.
- **Caching:** None required — the database itself serves as the cache, since agents
  write pre-computed recommendations on a schedule and the UI only reads them.

### Authentication & Security

- **Auth method:** Supabase Auth, **email/password** — the official starter ships
  working sign-up/login/forgot-password/reset-password forms using
  `supabase.auth.signInWithPassword`; reusing them is simpler than building a separate
  magic-link flow for a single trusted user (revised from an earlier magic-link
  proposal once the actual starter output was inspected).
- **Authorization:** Row Level Security (RLS) policies scoped to `auth.uid()` on every
  table, even with a single user — no cost now, zero rework later if a second user
  (e.g., a league-mate) is ever added.
- **Proxy (formerly "Middleware"):** current Next.js (16.3.3) renamed the Middleware
  API to **Proxy** — the file is `proxy.ts` at the project root, exporting
  `async function proxy()`, not `middleware.ts`/`middleware()`. The starter's generated
  `proxy.ts` + `lib/supabase/proxy.ts` must be **extended to also gate `/`** — as
  shipped, it only redirects unauthenticated users away from non-root routes, leaving
  the home/dashboard route (which will hold real personal data) publicly reachable.
  Both fixes are applied: `/` is now gated, and `/api` is explicitly excluded from the
  session-redirect check (found while testing cron routes locally — `/api/cron/*`
  authenticates via `CRON_SECRET`, not a session cookie, and was being redirected to
  `/auth/login` before that check ever ran).
- **Secret handling:** Supabase service-role key and all LLM provider keys are
  server-only environment variables, never shipped to the client. Sleeper requires no
  key (public API).
- **Cron protection:** Vercel's built-in `CRON_SECRET` header verification on
  cron-triggered routes prevents public triggering of agent jobs.

### API & Communication Patterns

- **Internal:** Next.js Route Handlers (`app/api/...`) for cron-triggered agent jobs;
  Server Actions for user-triggered actions (manual re-sync, submitting a trade for
  evaluation).
- **External clients:** one small typed module per integration (`lib/sleeper.ts`,
  `lib/perplexity.ts`, `lib/llm.ts`) rather than a generic abstraction layer — only 3-4
  integrations exist, so a framework for this would be premature.
- **LLM access:** `@anthropic-ai/sdk` (current: v0.122.0, requires Node 20 LTS+) for
  Claude directly; OpenRouter accessed via the OpenAI-compatible `openai` SDK pointed
  at OpenRouter's base URL, so models can be swapped by config rather than code change.
- **Error handling:** each external client returns a typed success/error result rather
  than throwing uncaught; the job runner catches per-integration failures and continues
  in degraded mode, satisfying the Integration Reliability NFR without a heavyweight
  framework.
- **Rate limiting:** simple retry-with-backoff in each client for outbound calls; no
  inbound rate limiting needed since there's no public API surface.

### Frontend Architecture

- **State management:** none globally — Server Components read straight from Supabase;
  local `useState` only for small interactive bits (e.g., filtering the waiver list). No
  Redux/Zustand.
- **Routing:** `/` (weekly summary dashboard), `/waivers`, `/roster`, `/trades` and
  `/news` (Growth phase), `/auth/login` + `/auth/sign-up` + `/auth/forgot-password`
  (starter default auth routes, reused as-is).
- **Components:** shared pieces including `RecommendationCard` and a
  `ReasoningDisclosure` (expand-to-see-why) — directly serves the "show reasoning, not
  just verdicts" requirement from the PRD's user journeys.
- **Performance:** no special optimization needed at single-user scale — Next.js
  defaults are sufficient.

### Infrastructure & Deployment

- **Hosting:** Vercel. **CI/CD:** git push → Vercel auto-deploy; no custom pipeline
  needed at this scale.
- **Environment config:** `.env.local` (gitignored) locally, Vercel Project Environment
  Variables in production.
- **Monitoring:** Vercel's built-in function logs plus Supabase's built-in logs —
  sufficient for a solo project at MVP.
- **Scaling:** explicitly out of scope — single user, no growth requirement per the
  PRD's NFRs.

### Decision Impact Analysis

**Implementation Sequence:**
1. Project init from the `with-supabase` starter (per Starter Template Evaluation).
2. Supabase schema + RLS policies + first migration.
3. Auth flow (email/password, already scaffolded) + extend `proxy.ts` to gate `/`.
4. Sleeper client + league sync (manual trigger first, cron later).
5. Waiver research agent + roster/matchup analysis agent (MVP core).
6. Dashboard UI reading from `recommendations`.
7. Vercel Cron wiring once the manual flow is proven.
8. Growth phase: trade evaluation agent, news/injury monitoring agent, their tables and
   routes.

**Cross-Component Dependencies:**
The `reasoning` field in the schema is a dependency for the frontend's
`ReasoningDisclosure` component, the NFR on transparency, and both MVP agents — it must
exist before any agent work starts, not retrofitted after. Similarly, RLS policies must
be in place before any real data sync happens, since retrofitting RLS onto live data is
more error-prone than building it in from the first migration.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 5 areas where different AI coding sessions
could plausibly diverge without explicit rules — database/API naming, file structure,
API response shape, error handling, and loading-state conventions.

### Naming Patterns

**Database Naming Conventions:**
- Tables: `snake_case`, plural (`recommendations`, `roster_players`).
- Columns: `snake_case` (`user_id`, `created_at`).
- Foreign keys: `<singular_table>_id` (`league_id`, `roster_id`).
- Primary keys: `id` (UUID, Supabase default).
- Timestamps: `created_at`, `updated_at` on every table (Postgres default `now()`).

**API Naming Conventions:**
- Route Handlers: `/api/<resource>` or `/api/cron/<job-name>` for scheduled jobs
  (e.g., `/api/cron/waiver-research`).
- No REST resource pluralization debate needed — there's no public REST API surface,
  just internal job triggers and Server Actions.

**Code Naming Conventions:**
- Components: `kebab-case` files, `PascalCase` exports (`recommendation-card.tsx`
  exporting `RecommendationCard`) — corrected during implementation to match the
  starter's own established convention (`login-form.tsx`, `auth-button.tsx`, etc.)
  rather than introducing a second, conflicting file-naming style.
- Non-component modules/utilities: `kebab-case` files (`sleeper-client.ts`), exported
  functions in `camelCase` (`getWaiverRecommendations`).
- Database rows read into TypeScript: `snake_case` at the DB boundary, but map to
  `camelCase` objects immediately after the Supabase query (one mapping layer, not
  scattered `snake_case` through app logic).

### Structure Patterns

**Project Organization:**
- `app/` — routes (App Router convention, fixed by the starter).
- `components/` — shared UI components, organized flat (not by feature) — the app is
  small enough that feature-based nesting would be overhead, not clarity.
- `lib/` — external integration clients (`lib/sleeper.ts`, `lib/llm.ts`,
  `lib/perplexity.ts`) and shared server-side logic.
- `lib/agents/` — the agent modules themselves (`waiver-research.ts`,
  `roster-analysis.ts`, and later `trade-evaluation.ts`, `news-monitoring.ts`).
- `supabase/migrations/` — versioned SQL migrations (Supabase CLI convention).

**File Structure Patterns:**
- Tests co-located with source as `*.test.ts` (not a separate `__tests__/` tree) —
  easier to keep test and implementation in sync in a solo project.
- Env vars documented in a committed `.env.example`, actual secrets only in
  `.env.local` (gitignored) and Vercel's environment variable settings.

### Format Patterns

**API Response Formats:**
- Route Handlers used only for cron triggers (not a public API), so responses are
  minimal: `{ ok: true, summary: string }` or `{ ok: false, error: string }` — just
  enough for logs, not a full API contract.
- Server Actions return typed results directly (no wrapper envelope needed — Next.js
  Server Actions already give you typed returns).

**Data Formats:**
- Dates: stored as Postgres `timestamptz`, passed through the app as ISO 8601 strings,
  formatted for display only at the UI edge.
- `snake_case` at the DB/API boundary, `camelCase` in TypeScript — converted at one
  mapping layer per integration, never mixed within a module.

### Communication Patterns

**Event Systems:**
- No event bus / pub-sub needed at this scale — agents run as discrete scheduled jobs
  that read from and write to Supabase directly. If Growth-phase agents need to react
  to each other (e.g., news agent → roster agent), that's a direct function call or a
  shared table read, not an event system.

**State Management:**
- N/A beyond what's already decided in Core Architectural Decisions (no global client
  state) — nothing further to define here.

### Process Patterns

**Error Handling:**
- Each `lib/` client returns `{ ok: true, data }` or `{ ok: false, error }` — never
  throws for expected failure modes (API down, rate limited). Agents catch these and
  log + continue in degraded mode per the Integration Reliability NFR.
- Unexpected/programmer errors (bugs) are allowed to throw and surface in Vercel's
  function logs — no need to swallow those.

**Loading States:**
- Since the dashboard reads pre-computed data (not live agent runs triggered by page
  load), there's no "waiting on an agent" loading state to design for in MVP — just
  standard Next.js route-level loading (`loading.tsx`) for data fetch latency.

### Enforcement Guidelines

**All AI Agents (and future you) MUST:**
- Use `snake_case` in the database, `camelCase` in TypeScript, with mapping only at
  the query boundary.
- Return typed `{ ok, data | error }` results from every external integration client —
  never let a Sleeper/news/LLM failure throw uncaught into an agent job.
- Add a `reasoning` value to every row in `recommendations` — no recommendation without
  a stored "why."
- Write a Supabase CLI migration for every schema change — no ad hoc dashboard edits.

**Pattern Enforcement:**
- These rules live in this architecture doc as the source of truth; if a future
  session (human or AI) needs to deviate, update this doc first, then the code.

### Pattern Examples

**Good Example:**
```ts
// lib/sleeper.ts
export async function getLeagueRosters(leagueId: string): Promise<
  { ok: true; data: Roster[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
    if (!res.ok) return { ok: false, error: `Sleeper returned ${res.status}` };
    return { ok: true, data: mapRosters(await res.json()) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
```

**Anti-Pattern:**
```ts
// Don't: throws on expected failure, mixes snake_case/camelCase, no reasoning stored
export async function getLeagueRosters(league_id: string) {
  const res = await fetch(`...${league_id}/rosters`);
  return res.json(); // throws uncaught on network failure, unmapped raw Sleeper JSON
}
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```
fantasy-football-copilot/
├── README.md
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.local                          # gitignored, local secrets
├── .env.example                        # committed, documents required vars
├── .gitignore
├── proxy.ts                             # auth gate — extended to also cover `/`
├── vercel.json                         # cron schedule definitions
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── (app)/                          # route group: gated pages, shares nav-bar.tsx
│   │   ├── layout.tsx                  # wraps children with <NavBar />
│   │   ├── page.tsx                    # dashboard / weekly summary — FR22
│   │   ├── waivers/page.tsx            # FR10-13
│   │   ├── roster/page.tsx             # FR5-9
│   │   ├── history/page.tsx            # FR23
│   │   ├── trades/page.tsx             # Growth phase — FR14-17 (not yet built)
│   │   └── news/page.tsx               # Growth phase — FR18-21 (not yet built)
│   ├── auth/
│   │   ├── login/page.tsx              # email/password auth entry (starter default)
│   │   ├── sign-up/page.tsx            # already scaffolded by starter
│   │   └── forgot-password/page.tsx    # already scaffolded by starter
│   └── api/
│       └── cron/
│           ├── sync-league/route.ts            # FR1-4
│           ├── waiver-research/route.ts         # FR10-13
│           ├── roster-analysis/route.ts         # FR5-9
│           ├── trade-evaluation/route.ts        # FR14-16 (built)
│           ├── trade-suggestions/route.ts       # FR17 (built) — weekly, not daily
│           └── news-monitoring/route.ts         # FR18-21 (built)
├── components/
│   ├── recommendation-card.tsx          # FR6, FR12, FR16
│   ├── reasoning-disclosure.tsx         # FR6, FR12, FR16
│   ├── weekly-summary.tsx               # FR9, FR22
│   ├── waiver-list.tsx                  # FR10
│   ├── roster-table.tsx                 # FR5, FR8
│   └── nav-bar.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # browser Supabase client
│   │   ├── server.ts                   # server Supabase client (user session, RLS)
│   │   ├── service.ts                  # service-role client for cron/agents (bypasses RLS)
│   │   └── proxy.ts                    # session refresh helper (updateSession)
│   ├── sleeper.ts                      # FR1-4, plus trending-add signal for waivers,
│   │                                     plus getPlayerWeekStats (FR13d)
│   ├── sleeper-sync.ts                 # league/roster/player/matchup/moves sync logic
│   ├── waiver-moves.ts                 # FR13d: move<->recommendation matching + real
│   │                                     point-outcome computation
│   ├── chat.ts                         # FR29-30: chat turn, grounded in the same
│   │                                     context agents use, persists directives to
│   │                                     player_notes/team_strategy_notes
│   ├── cron-auth.ts                    # shared CRON_SECRET verification
│   ├── llm.ts                          # Anthropic + OpenRouter clients, model routing
│   ├── perplexity.ts                   # search-grounded research (FR6a/FR12a; built
│   │                                     for MVP, also the Growth news source — see
│   │                                     Web App Specific Requirements)
│   ├── agents/
│   │   ├── shared.ts                   # shared context loader (loadAgentContext for
│   │   │                                 cron, loadLeagueRosterContext shared with
│   │   │                                 chat.ts) + recommendation writer +
│   │   │                                 buildTeamStrategySummary
│   │   ├── waiver-research.ts          # FR10-13, FR13e (watchlist)
│   │   ├── roster-analysis.ts          # FR5-9
│   │   ├── trade-evaluation.ts         # FR14-16 (built)
│   │   ├── trade-suggestions.ts        # FR17 (built)
│   │   └── news-monitoring.ts          # FR18-21 (built)
│   └── types.ts                        # shared TS types mirroring DB schema
└── supabase/
    └── migrations/
        ├── <timestamp>_init_schema.sql        # players, leagues, rosters,
        │                                 roster_players, matchups, recommendations
        ├── <timestamp>_growth_schema.sql      # news_events, trades (added at Growth phase)
        ├── <timestamp>_add_api_cache.sql      # api_cache (Perplexity/LLM caching layer)
        ├── <timestamp>_add_player_notes.sql   # player_notes (user's own reasoning per
        │                                       # player — see FR13b)
        ├── <timestamp>_add_roster_moves.sql   # roster_moves (real waiver/FA add-drop
        │                                       # tracking + outcome — see FR13d)
        └── <timestamp>_add_chat_and_watchlist.sql  # chat_messages, team_strategy_notes,
                                                     # watchlist_players — see FR13e, FR29-30
```

*(No separate `tests/` tree — per the Implementation Patterns step, tests are
co-located as `*.test.ts` next to the file they cover, e.g., `lib/sleeper.test.ts`,
`lib/agents/waiver-research.test.ts`.)*

### Architectural Boundaries

**API Boundaries:**
There is no public REST API. The only "API surface" is `app/api/cron/*` routes, which
exist solely to be triggered by Vercel Cron (protected by `CRON_SECRET`) and are not
meant for direct browser or third-party consumption.

**Component Boundaries:**
Server Components (in `app/`) fetch directly from Supabase and pass data down as props.
Client Components (`components/` marked `"use client"` where interactivity is needed,
e.g., filtering the waiver list) never call Supabase or external APIs directly — they
only receive data from their Server Component parent. This keeps all credentials and
external calls server-side, satisfying the Security NFR.

**Service Boundaries:**
Each `lib/agents/*.ts` module owns one capability area and is the only code allowed to
call its corresponding external clients (`lib/sleeper.ts`, `lib/llm.ts`, `lib/perplexity.ts`)
and write to its corresponding tables. E.g., `roster-analysis.ts` reads `rosters` +
`matchups` and writes `recommendations` — it does not reach into waiver logic, and vice
versa. This is what lets Growth-phase agents (`trade-evaluation.ts`,
`news-monitoring.ts`) be added later without touching MVP agent code.

**Data Boundaries:**
All database access goes through `lib/supabase/server.ts` (server-side) — no direct
Postgres connection strings or ORMs elsewhere. RLS policies are the actual security
boundary; application code should never rely solely on query-level filtering.

### Requirements to Structure Mapping

**FR Category Mapping:**
- League Connection & Sync (FR1-4) → `lib/sleeper.ts`, `app/api/cron/sync-league/`,
  `supabase/migrations/<timestamp>_init_schema.sql` (leagues/rosters/matchups tables)
- Roster & Matchup Analysis (FR5-9) → `lib/agents/roster-analysis.ts`,
  `app/(app)/roster/`, `components/roster-table.tsx`
- Waiver Wire Research (FR10-13) → `lib/agents/waiver-research.ts`, `app/(app)/waivers/`,
  `components/waiver-list.tsx`
- Trade Evaluation (FR14-17, Growth) → `lib/agents/trade-evaluation.ts`, `app/(app)/trades/`
- News & Injury Monitoring (FR18-21, Growth) → `lib/agents/news-monitoring.ts`,
  `lib/perplexity.ts`, `app/(app)/news/`
- Weekly Recommendations & Reporting (FR22-23) → `app/(app)/page.tsx`,
  `components/weekly-summary.tsx`, `app/(app)/history/`
- Notifications & Mobile Access (FR24-25, Vision) → not yet in this structure —
  deferred until the Vision phase; Next.js's responsive layout already covers "mobile
  access," push notifications would add a new `lib/notifications.ts` when built.
- Cost & Data Source Management (FR26-28, cross-cutting) → `lib/llm.ts` (model
  routing/selection lives here), reflected in every agent's design rather than living
  in one file.

**Cross-Cutting Concerns:**
- **Reasoning transparency** → `recommendations.reasoning` column (schema), surfaced by
  `reasoning-disclosure.tsx` (UI) — touches every agent, every recommendation type.
- **Auth/Security** → `proxy.ts`, `lib/supabase/server.ts`, RLS policies in every
  migration — applies uniformly across all routes and tables.

### Integration Points

**Internal Communication:**
Server Components → Supabase (read) directly. User-triggered mutations → Server
Actions → Supabase (write). Scheduled work → Vercel Cron → `app/api/cron/*` Route
Handler → corresponding `lib/agents/*.ts` → external client(s) in `lib/` → Supabase
(write) → later read by a Server Component.

**External Integrations:**
- Sleeper public API (`lib/sleeper.ts`) — no auth, read-only.
- Claude API via `@anthropic-ai/sdk` and/or OpenRouter via the `openai` SDK
  (`lib/llm.ts`) — used by every agent for analysis/reasoning generation.
- Perplexity Sonar API via the `openai` SDK pointed at Perplexity's base URL
  (`lib/perplexity.ts`) — search-grounded research with cited sources, used by both
  MVP agents already (built during implementation, not deferred to Growth).
- Supabase (Postgres + Auth) — the only stateful backend dependency.

**Data Flow:**
Sleeper → `sync-league` cron → Supabase (`leagues`/`rosters`/`matchups`) →
`roster-analysis` / `waiver-research` crons read that data + call the LLM → write to
`recommendations` (with `reasoning`) → dashboard Server Components read
`recommendations` → user sees the weekly summary. Growth phase inserts
`news-monitoring` and `trade-evaluation` as parallel branches feeding the same
`recommendations` table.

### File Organization Patterns

**Configuration Files:** root-level, standard Next.js/TypeScript locations
(`next.config.ts`, `tsconfig.json`, `tailwind.config.ts`) — no custom config directory.

**Source Organization:** flat `components/` and `lib/` (not feature-nested) per the
Implementation Patterns decision — the project is small enough that this stays
navigable without deeper nesting.

**Test Organization:** co-located `*.test.ts`/`*.test.tsx` next to source files.

**Asset Organization:** default Next.js `public/` for any static assets (favicon, etc.)
— nothing beyond the default is needed for this project.

### Development Workflow Integration

**Development Server:** `next dev` locally, reading from `.env.local` — the same
`app/`/`lib/` code runs unchanged in every environment (local, Vercel).

**Build Process:** standard `next build`; no custom build steps. Supabase migrations
are applied via `supabase db push` (or CI/CD equivalent later) as a separate, explicit
step — never implicitly run by the app build.

**Deployment Structure:** `git push` to the connected branch triggers Vercel's build +
deploy; `vercel.json` cron definitions are picked up automatically on deploy — no
separate infrastructure to provision.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** TypeScript + Next.js 16.3.3 + Supabase + Vercel Cron are
mutually consistent and mainstream-supported together — no version conflicts. The
`@anthropic-ai/sdk` (v0.122.0, Node 20+) and OpenRouter-via-`openai`-SDK choice both run
fine in Vercel's Node.js function runtime.

**Pattern Consistency:** The `snake_case`/`camelCase` boundary rule, the
`{ ok, data | error }` client contract, and the `reasoning`-as-first-class-data rule are
all reflected consistently in the Project Structure section (e.g., every `lib/agents/*`
module follows the same shape).

**Structure Alignment:** The directory tree directly implements the Core Architectural
Decisions — Server/Client Component boundary enforces the "secrets never reach the
client" security decision, and `lib/agents/` ownership boundaries enforce the
per-capability isolation needed for Growth-phase additions.

### Requirements Coverage Validation ✅ (with 2 noted gaps)

**Functional Requirements Coverage:** All 28 FRs trace to a specific file or table —
see the Requirements to Structure Mapping in the previous section. Two minor gaps found:

1. **FR23** ("review history of past recommendations and whether they were followed")
   — ~~RESOLVED during schema design~~: `recommendations` carries a `status` column
   (`pending`/`followed`/`not_followed`/`dismissed`) and serves as its own history —
   the separate `recommendation_history` table was dropped as redundant. A
   `markRecommendationFollowed` Server Action (updating `status`) still needs to be
   built when the history feature is implemented.
2. **Initial account creation** — the email/password auth flow assumes an account
   already exists; nothing specifies how Zimrri's one Supabase Auth user gets created
   initially. Non-blocking — sign up once through the starter's own `/auth/sign-up`
   page, or create the user directly in the Supabase dashboard.
3. **`/` was publicly reachable in the as-generated starter** — found and corrected
   during implementation (see Framework-Specific Rules in `project_context.md`):
   `proxy.ts` must gate `/` in addition to the routes it already protects.

**Non-Functional Requirements Coverage:**
- *Performance* ✅ — Vercel Cron's once-daily cadence (verified current limit) directly
  satisfies "pre-computed ahead of deadlines."
- *Security* ✅ (once the `/` gating fix above is applied) — RLS + server-only secrets +
  `CRON_SECRET` + proxy auth gate.
- *Integration Reliability* ✅ — typed `{ ok, error }` client contract + degraded-mode
  handling specified for every external dependency.
- *Cost Efficiency* ✅ — free Sleeper API, free/cheap news sources, pay-as-you-go LLM
  routing, batched cron scheduling — all traced through the architecture, not just
  mentioned once and dropped.

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical decisions carry verified current versions
(Next.js 16.3.3, Zod 4.4.3, `@anthropic-ai/sdk` 0.122.0) rather than assumed/stale ones.

**Structure Completeness:** Every FR category maps to a concrete file; no
`{{placeholder}}` directories — the tree in Project Structure is the literal structure
to create.

**Pattern Completeness:** Naming, error handling, and data-format conflict points are
all resolved with concrete examples (see Pattern Examples in the previous section).

### Gap Analysis Results

**Critical Gaps:** None — nothing here blocks starting implementation.

**Important Gaps:**
- FR23's "followed/not followed" interaction needs a Server Action (noted above) —
  worth deciding during the epics/stories step rather than architecture, since it's a
  UI-interaction detail, not a structural one.

**Nice-to-Have Gaps:**
- No dedicated observability tool (deliberately deferred per Core Architectural
  Decisions) — revisit only if debugging agent failures from raw logs gets painful.
- No CI checks (lint/typecheck on push) yet — cheap to add later via GitHub Actions,
  not needed to start building.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — every FR traces to a concrete file, every NFR traces to a
concrete mechanism, and the two gaps found are minor UI/setup details, not structural
holes.

**Key Strengths:**
- Cost discipline isn't a footnote — it's threaded through cron cadence, model routing,
  and data-source choice consistently.
- The per-agent ownership boundary (`lib/agents/*`) means Growth-phase agents
  (trade evaluation, news monitoring) can be added without touching MVP code.
- Zero paid infrastructure required to reach MVP — Vercel Hobby, Supabase free tier,
  Sleeper's free API, and pay-as-you-go LLM usage only.

**Areas for Future Enhancement:**
- Observability tooling once agent behavior needs deeper debugging.
- CI checks (lint/typecheck) once the codebase is large enough that regressions become
  easy to miss.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented in this file.
- Use implementation patterns consistently across all components.
- Respect the project structure and the per-agent ownership boundaries.
- Refer to this document for all architectural questions before improvising.

**First Implementation Priority:**
`npx create-next-app --example with-supabase fantasy-football-copilot`, then the
`<timestamp>_init_schema.sql` migration (schema before any agent code), per the Implementation
Sequence in Core Architectural Decisions.

## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED ✅
**Total Steps Completed:** 8
**Date Completed:** 2026-08-28
**Document Location:** `docs/architecture.md`

### Final Architecture Deliverables

**📋 Complete Architecture Document**
- All architectural decisions documented with specific, verified versions
- Implementation patterns ensuring AI agent consistency
- Complete project structure with all files and directories
- Requirements to architecture mapping (all 28 FRs + all 4 NFR categories)
- Validation confirming coherence and completeness (2 minor non-blocking gaps noted)

**🏗️ Implementation Ready Foundation**
- ~25 architectural decisions made across Data, Auth/Security, API/Communication,
  Frontend, and Infrastructure categories
- 5 implementation pattern categories defined (naming, structure, format,
  communication, process)
- 5 major architectural components specified (frontend, Route Handlers/cron,
  Supabase data layer, external integration clients, agent modules)
- All 28 functional requirements + all 4 NFR categories fully supported

**📚 AI Agent Implementation Guide**
- Technology stack with verified current versions (Next.js 16.3.3, Zod 4.4.3,
  `@anthropic-ai/sdk` 0.122.0)
- Consistency rules that prevent implementation conflicts
- Project structure with clear per-agent ownership boundaries
- Integration patterns and communication standards

### Implementation Handoff

**For AI Agents:** This architecture document is the complete guide for implementing
Fantasy Football Copilot. Follow all decisions, patterns, and structures exactly as
documented here.

**First Implementation Priority:**
`npx create-next-app --example with-supabase fantasy-football-copilot`

**Development Sequence:**
1. Initialize project using the documented starter template command.
2. Set up Supabase project + apply `<timestamp>_init_schema.sql` (schema and RLS before any
   agent code).
3. Confirm email/password auth (already scaffolded) + fix `proxy.ts` to gate `/`.
4. Build `lib/sleeper.ts` + `sync-league` cron — get real data flowing first.
5. Build the two MVP agents (`roster-analysis`, `waiver-research`) + dashboard UI.
6. Wire Vercel Cron once the manual flow is proven end-to-end.
7. Growth phase: trade evaluation + news monitoring agents, their schema, their routes.

### Quality Assurance Checklist

**✅ Architecture Coherence**
- [x] All decisions work together without conflicts
- [x] Technology choices are compatible
- [x] Patterns support the architectural decisions
- [x] Structure aligns with all choices

**✅ Requirements Coverage**
- [x] All functional requirements are supported
- [x] All non-functional requirements are addressed
- [x] Cross-cutting concerns are handled
- [x] Integration points are defined

**✅ Implementation Readiness**
- [x] Decisions are specific and actionable
- [x] Patterns prevent agent conflicts
- [x] Structure is complete and unambiguous
- [x] Examples are provided for clarity

### Project Success Factors

**🎯 Clear Decision Framework**
Every technology choice was made collaboratively with clear rationale — TypeScript +
Next.js + Vercel + Supabase, chosen specifically for zero ops overhead, free-tier cost
fit, and portability to self-hosting later if desired.

**🔧 Consistency Guarantee**
Naming conventions, error-handling contracts, and per-agent ownership boundaries ensure
that MVP and Growth-phase work stay compatible without a redesign.

**📋 Complete Coverage**
All 28 FRs and all 4 NFR categories are architecturally supported, with a direct
mapping from PRD requirement to specific file or table.

**🏗️ Solid Foundation**
The official `with-supabase` Next.js starter, verified against current versions, gives
a production-ready foundation without unrelated SaaS scaffolding to strip out.

---

**Architecture Status:** READY FOR IMPLEMENTATION ✅

**Next Phase:** Begin implementation — project initialization, schema migration, then
the MVP agents — using the decisions and patterns documented in this file.

**Document Maintenance:** Update this architecture when major technical decisions
change during implementation.
