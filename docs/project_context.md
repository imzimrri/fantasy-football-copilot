---
project_name: 'Fantasy Football Copilot'
user_name: 'Zimrri'
date: '2026-08-29'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 34
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss. See `docs/architecture.md` for full rationale — this file is the lean, load-first cheat sheet._

---

## Technology Stack & Versions

- Next.js **16.3.3** (App Router), React **19**, TypeScript (strict mode)
- Tailwind CSS **3.4.1**, shadcn/ui components already installed (`components/ui/*`:
  button, card, input, label, badge, checkbox, dropdown-menu)
- `@supabase/ssr` + `@supabase/supabase-js` (both `latest`) — Postgres + Auth
- `@anthropic-ai/sdk` (`^0.122.0`, Claude) and `openai` (`^7.8.0`) — the latter used
  BOTH for OpenRouter (`lib/llm.ts`, model-flexible LLM access) AND for Perplexity's
  Sonar API (`lib/perplexity.ts`, `baseURL: "https://api.perplexity.ai"`) — Perplexity
  is OpenAI-compatible, so it reuses the same SDK rather than adding a new dependency.
- Zod (`^4.5.2`) for validating all external API payloads
- Vitest (`^4.1.11`) for unit tests — `npm test`
- Deploy target: Vercel (Hobby/free tier) with Vercel Cron for scheduled agent runs
- Path alias: `@/*` → project root (NOT `src/` — there is no `src/` directory)

## Critical Implementation Rules

### Language-Specific Rules

- TypeScript `strict: true` is on — no implicit `any`, handle all null/undefined cases
  explicitly.
- Map `snake_case` (DB/API boundary) to `camelCase` (TypeScript) at exactly one point
  per integration — never mix the two conventions within a module.
- External integration clients (Sleeper, news, LLM) must return
  `{ ok: true; data } | { ok: false; error: string }` — never throw for expected
  failure modes (API down, rate limited). Only let genuine bugs throw.

### Framework-Specific Rules (Next.js / React)

- **`middleware.ts` is the WRONG filename for this Next.js version.** The current API
  is named **Proxy**: the file is `proxy.ts` at the project root, exporting
  `export async function proxy(request: NextRequest)`, not `middleware()`. It's already
  generated at `proxy.ts` + `lib/supabase/proxy.ts` (`updateSession`) — extend that
  file, don't create a separate `middleware.ts`.
- **`proxy.ts`'s session-redirect check must exclude `/api`** — the starter's
  redirect-to-login logic originally ran on every route including `/api/cron/*`,
  which meant those routes got redirected before their own `CRON_SECRET` check in
  `lib/cron-auth.ts` ever ran (found while testing the cron routes locally). Already
  fixed — `pathname.startsWith("/api")` is excluded alongside `/login` and `/auth`. Any
  new `/api/*` route needs its own auth (Bearer token, etc.), not the session cookie.
- **`/` is gated — this doc used to warn it wasn't; that's now stale.** Verified
  2026-08-29 by reading `lib/supabase/proxy.ts`'s redirect condition directly: it only
  excludes `/login`, `/auth`, and `/api` from the "no user -> redirect to
  `/auth/login`" check, so `/` (and every other real page) already requires a session.
  `proxy.ts`'s `matcher` also doesn't exclude `/`. If a future change to the redirect
  condition or matcher ever narrows this, re-verify before deploying — this is the one
  check that actually keeps personal roster/recommendation data private pre-deploy.
- Env vars are named `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (NOT `NEXT_PUBLIC_SUPABASE_ANON_KEY` — that's
  outdated naming from older Supabase starter versions).
- Auth is **email/password** (`supabase.auth.signInWithPassword`), already implemented
  in `components/login-form.tsx`, `sign-up-form.tsx`, `forgot-password-form.tsx`,
  `update-password-form.tsx`. Do not build a separate magic-link flow — reuse these.
- **`cacheComponents: true` is set in `next.config.ts`** (Next.js 16's successor to
  the old `experimental.ppr` flag). Any Server Component that calls `cookies()`
  (including indirectly, via `lib/supabase/server.ts`'s `createClient()`) or does an
  uncached `fetch`/DB call MUST be wrapped in `<Suspense>` — the build fails otherwise
  ("uncached or runtime data during prerendering"). Pattern used throughout
  `app/(app)/*`: export a plain sync `Page()` that renders `<Suspense fallback={...}>`
  around a separate async `*Content()` component that does the actual data fetching.
  Do not reach for `'use cache'` on per-user session data — that's for cacheable data,
  not user-scoped RLS-filtered queries.
- Server Components fetch from Supabase directly; Client Components (`"use client"`)
  never call Supabase or external APIs directly — they only receive data as props from
  a Server Component parent. This is what keeps secrets server-only.
- Route Handlers under `app/api/cron/*` exist only to be triggered by Vercel Cron
  (protected by `CRON_SECRET`) — they are not a public API and should never be called
  from client code.
- No global client state library (no Redux/Zustand) — local `useState` only, for small
  interactive bits.

### Testing Rules

- Tests are co-located as `*.test.ts` / `*.test.tsx` next to the file they cover — no
  separate `__tests__/` or `tests/` tree.
- No test framework installed yet — add one deliberately (e.g., Vitest) when the first
  test is actually needed, don't accept whatever a scaffold happens to bundle.

### Code Quality & Style Rules

- ESLint flat config: `next/core-web-vitals` + `next/typescript` — already configured,
  don't add a second linting config.
- **`npm run lint` picks up `.next/types/*` if a build artifact exists**, producing
  hundreds of false-positive errors unrelated to your code. Run `rm -rf .next` before
  `npm run lint` if you've run `next build`/`next dev` recently and see a wall of
  `no-unused-vars`/`ban-ts-comment` errors in `.next/types/routes.d.ts`.
- Database: `snake_case`, plural table names, `id` (UUID) primary key, `created_at`/
  `updated_at` timestamps, foreign keys as `<singular_table>_id`.
- TypeScript: `kebab-case` component files (`recommendation-card.tsx`) with
  `PascalCase` exports (`RecommendationCard`) — matches the starter's own existing
  components (`login-form.tsx`, `auth-button.tsx`), not the PascalCase-filename
  convention originally proposed in `architecture.md`'s first draft. `kebab-case` for
  non-component files, `camelCase` for functions/variables.
- Gated app pages live under `app/(app)/` (a route group — doesn't affect the URL, so
  `app/(app)/waivers/page.tsx` still serves `/waivers`). Its `layout.tsx` renders
  `<NavBar />`. Auth pages (`app/auth/*`) are outside this group and have no nav.
- Every row written to the `recommendations` table MUST include a `reasoning` value —
  this is a hard requirement (FR6/FR12/FR16 in the PRD), not optional polish.

### Development Workflow Rules

- Supabase schema changes go through **versioned SQL migrations** in
  `supabase/migrations/`, applied via the Supabase CLI — never edit the schema directly
  in the Supabase dashboard.
- `git push` to the connected branch auto-deploys via Vercel — no custom CI/CD pipeline
  exists or is needed yet.
- Secrets live in `.env.local` (gitignored) locally and Vercel's Environment Variables
  in production — never commit real keys; `.env.example` documents required var names
  only.

### Critical Don't-Miss Rules

- **Do not reintroduce `middleware.ts`.** If you see references to it (including in
  older Next.js docs, tutorials, or your own training data), the current API in this
  project is `proxy.ts` / `export async function proxy()`. This is the single most
  likely stale-knowledge mistake to make in this codebase.
- **`/` is already gated** (see the fuller note above) — don't "fix" this again
  without first re-reading `lib/supabase/proxy.ts`'s actual current redirect
  condition; a stale version of this rule used to claim it wasn't gated.
- **Do not add features beyond the PRD's Functional Requirements** (`docs/prd.md`) —
  anything not listed there should not be built without updating the PRD first.
- **Do not use the paid Twitter/X API** — news/social sourcing must use free sources
  (RSS, Reddit) per the PRD's cost constraint.
- **Do not call LLM providers synchronously on page load** — all agent analysis runs on
  a schedule (Vercel Cron) and writes to Supabase; the UI only reads pre-computed data.
- Single-user app: RLS policies scoped to `auth.uid()` are still required on every
  table even though there's only one user — don't skip RLS because "it's just me."
  Exception: `players` (global Sleeper player cache) is public NFL data with an
  any-authenticated-user read policy — it has no `user_id` column, don't add one.
- **`lib/cache.ts` caches every Perplexity (`research()`) and LLM (`generateText()`)
  call** in the `api_cache` table, keyed by a hash of the exact request (provider,
  model, prompt/query). Perplexity: 6h TTL. LLM: 2h TTL. A cache hit skips the real API
  call entirely — verified live: repeated `waiver-research` run went from 24.6s (cold)
  to 1.5s (cache hit), zero extra token spend. Cache failures never break the caller
  (best-effort, swallowed) — this is a cost optimization, not a correctness dependency.
  A real data change (different roster/research state) produces a different prompt and
  thus a different key, so this never serves stale data for genuinely new input.
- Schema is live in `supabase/migrations/20260829063709_init_schema.sql`: `players`,
  `leagues`, `rosters`, `roster_players`, `matchups`, `recommendations`. There is NO
  separate `recommendation_history` table — `recommendations.status`
  (`pending`/`followed`/`not_followed`/`dismissed`) serves both the weekly view and the
  history view (FR22/FR23). Every `recommendations` row requires `reasoning`.
- Migration filenames use the Supabase CLI's `<timestamp>_<name>.sql` convention
  (generate new ones with `supabase migration new <name>`) — not sequential `0001_`
  numbering.
- **An "identity-linked" Anthropic API key needs the `anthropic-workspace-id` header
  set explicitly — `ANTHROPIC_WORKSPACE_ID` alone does NOT do it.** Found while testing
  roster-analysis: 400 `anthropic-workspace-id is required when authenticating with an
  identity-linked API key`. `@anthropic-ai/sdk`'s credential resolver reads
  `ANTHROPIC_WORKSPACE_ID` into its config (`core/credentials.js`), but that value is
  NOT auto-forwarded as a request header when using plain `apiKey` auth — confirmed by
  testing directly against the API (both `new Anthropic({apiKey})` and the zero-arg
  `new Anthropic()` failed identically with the var set). It only feeds a separate
  WIF/OAuth credential-exchange flow. **The actual fix**, applied in `lib/llm.ts`:
  `new Anthropic({ apiKey, defaultHeaders: { "anthropic-workspace-id": workspaceId } })`.
  Plain `sk-ant-...` keys don't need this at all.
- **Every agent that reasons about player VALUE must include `ctx.rosterPositions` in
  its prompt, not just `ctx.scoringSettings`.** This league is Superflex/2QB
  (`roster_positions` includes a `SUPER_FLEX` slot) — QBs are much more valuable here
  than in a standard 1-QB league. Found via a real bad output: trade-suggestions called
  this "a 1-QB league where QB depth is replaceable," which is factually wrong and
  would have undervalued a real trade asset. Only `roster-analysis.ts` originally
  included this context; `waiver-research.ts`, `trade-evaluation.ts`, and
  `trade-suggestions.ts` were all missing it — now fixed in all three. Any future agent
  that reasons about a player's value/scarcity needs this too.
- **Don't use a strict Zod `.refine()` to cross-check an LLM-generated field against a
  known list (e.g., "this player name must be exactly one of these bench players").**
  One slightly-off value (extra whitespace, appended context like "(QB)") fails the
  ENTIRE array validation — observed in testing on `waiver-research.ts`'s
  `dropCandidate`. Instead: require non-empty in the schema, then fuzzy-resolve in
  application code (case/whitespace-insensitive, then substring match — see
  `resolveDropCandidate` in `lib/agents/waiver-research.ts`) and log+flag (don't
  silently trust) an unresolvable value rather than losing the whole batch over it.
- **Use `||`, not `??`, for optional env-var-with-default fallbacks** (e.g. model
  names). `.env.example` documents optional vars with a blank value
  (`PERPLEXITY_MODEL=`) — that resolves to `""`, not `undefined`, so `??` silently
  keeps the empty string instead of falling through to the hardcoded default. Bit
  `PERPLEXITY_MODEL` and `ANTHROPIC_MODEL` in exactly this way (400 `Invalid model ''`)
  — both fixed to use `||`. Applies to any future `process.env.X ?? default` for a
  value that must never legitimately be `""`.
- **Never render an externally-sourced URL as `href` without validating the scheme.**
  Perplexity's `sources`/`citations` are untrusted API data — a `javascript:` URL there
  would execute on click. Filter to `http:`/`https:` only at the source (before
  storage, in `lib/perplexity.ts`) AND again at the render site (`sources-list.tsx`),
  defense in depth. Apply this same pattern to any future external-URL-rendering code
  (e.g. the Growth-phase news agent).
- **`user_id default auth.uid()` does NOT help cron/agent writes.** Cron jobs use the
  Supabase **service-role** client (no user session), so `auth.uid()` resolves to NULL
  there — the default only fires for authenticated-session inserts (which this app
  barely has, since agents do the writing). Every `lib/agents/*.ts` insert MUST set
  `user_id` explicitly (e.g., a `FFC_USER_ID` env var holding the one Supabase Auth
  user's UUID) — don't rely on the column default in agent/cron code.
- **Research grounding must cover BOTH sides of every decision an agent reasons about,
  not just the "new" side.** Real bug (user-reported): `waiver-research.ts` only
  researched the trending ADD candidates, never the bench players being evaluated as a
  DROP — so a factual claim like "Khalil Shakir is Buffalo's WR4/5" was pure ungrounded
  LLM recall, shown misleadingly next to sources that were actually about unrelated
  players. He's really their WR2. Fixed by extending the Perplexity query to also cover
  bench/drop-candidate names, and adding an explicit "only state a depth-chart claim if
  it's backed by the research below" guardrail to the system prompt — now present in
  `waiver-research.ts`, `roster-analysis.ts`, and `trade-evaluation.ts`. Re-verified
  live afterward: Shakir was correctly identified as "confirmed as WR2 on Buffalo's
  current depth chart." Any new agent that makes claims about a player's current
  role/depth-chart position needs this same both-sides research + guardrail pattern.
- **`player_notes` table lets the user attach their own reasoning to a roster player**
  (e.g., "handcuff in case Mahomes gets hurt") via `PlayerNoteEditor` on every lineup
  row (`components/lineup-row.tsx`) — `savePlayerNote` server action
  (`app/(app)/roster/actions.ts`), one note per `(user_id, sleeper_player_id)`.
  `loadAgentContext()` (`lib/agents/shared.ts`) loads all of the user's notes into
  `ctx.playerNotes: Map<sleeperPlayerId, note>` for every agent to use. **Any agent
  that could recommend dropping/benching a player MUST check this map and explicitly
  engage with a matching note in its reasoning** — confirm it still holds or give a
  specific reason it doesn't — never silently override the user's stated intent. Wired
  into `waiver-research.ts` and `roster-analysis.ts` so far. In `waiver-research.ts`
  this can produce a pure "note response" recommendation with no `addPlayer`/
  `dropCandidate` (validating the user's hold without an actual add) — the schema makes
  both fields (and `restOfSeasonOutlook`) optional via `superRefine`, required only
  when an add is actually being recommended; the LLM is instructed to omit them rather
  than write a placeholder like `"N/A"` (which would render as a broken "Add N/A" line
  in `RecommendationCard`'s `ActionSummary`). Verified live: a real note ("handcuff in
  case Mahomes gets hurt" on Justin Fields) produced a recommendation explicitly
  confirming the reasoning was sound and telling the user to keep him.
- **`roster_moves` tracks every real waiver/free-agent add-drop synced from Sleeper's
  transactions endpoint** (trade-type transactions still go to the separate `trades`
  table) — see `/moves` page, `lib/waiver-moves.ts`. Auto-matched to the pending
  waiver recommendation it acted on via fuzzy name match on `addPlayer`/
  `dropCandidate` (`findMatchingWaiverRecommendation`), which also auto-marks that
  recommendation `followed` (only if it's still `pending` — never overwrites a status
  the user set manually). Outcome (`computeMoveOutcome`) sums real per-player weekly
  points from Sleeper's `/stats/nfl/regular/{season}/{week}` endpoint (cached like
  everything else in `lib/cache.ts`, 6h TTL) using whichever `pts_*` field matches the
  league's own scoring format (`pointsFieldForLeague`: `rec===1` → `pts_ppr`,
  `rec===0`/missing → `pts_std`, else → `pts_half_ppr` — this league is 0.5, so
  `pts_half_ppr`). **Only counts fully COMPLETED weeks** — `resolveLastCompletedWeek`
  in `lib/sleeper.ts` (current week minus 1, 0 during preseason/offseason) — never the
  in-progress week, since a partial total would misread as final. When zero completed
  weeks have elapsed since the move, the outcome is `weeksCounted: 0` with real
  `0`-point placeholders; the UI must render that as "too early to tell," never as a
  real 0-0 tie. Live-verified end-to-end against a real synced move (Justin Fields
  added, Shedeur Sanders dropped, pre-season so correctly `weeksCounted: 0`).

- **Chat (`/chat`) is a real input channel into agent behavior, not just Q&A.**
  `lib/chat.ts`'s `runChatTurn` grounds every reply in the same real roster/notes/
  watchlist context every cron agent uses (`loadLeagueRosterContext`, extracted from
  `loadAgentContext` in `lib/agents/shared.ts` specifically so the session-scoped
  client — real `auth.uid()`, not the service-role/`FFC_USER_ID` cron path — can reuse
  it). A statement about ONE player (e.g. "I'm OK trading Andrews") becomes a
  `player_notes` upsert (empty-string note clears one — e.g. reversing a prior
  handcuff stance); a team-wide roster-construction policy not tied to one player
  (e.g. "I only want to keep 2 QBs") becomes a `team_strategy_notes` entry
  (append-only log, most-recent-first, read by every agent via
  `buildTeamStrategySummary`). Non-streaming — one Server Action round-trip per turn,
  not SSE; fine for a personal-use copilot's few-second wait. Verified live end-to-end
  with the user's own real scenario: a message covering 5 different player/team
  directives correctly produced 4 player-note upserts, 1 team-strategy entry, and (on
  the next waiver-research run) real recommendations acting on all of them — including
  auto-clearing a now-contradicted prior note.
- **Free-agent watchlist (`watchlist_players`) — waiver-research evaluates every
  watched player every run, regardless of trending status.** This is the entire point
  (catch a player before the whole league is bidding on them, not after). UI on
  `/waivers` (`components/watchlist-panel.tsx`, debounced search against the `players`
  cache via `searchPlayers` in `app/(app)/waivers/actions.ts` — no external API call
  needed, it's already fully synced). `waiver-research.ts` unions available-trending
  and available-watchlist candidates before the roster-is-full/research/LLM steps, so
  a watched player can produce a real add recommendation, or a "not worth it yet, here
  is why" status update, on a week it isn't even trending.
- **A structured-output schema field the model is told to OMIT must be `.nullish()`,
  not `.optional()`.** Real bug, live: `waiver-research.ts` instructed the model to
  omit `addPlayer`/`dropCandidate`/`restOfSeasonOutlook` for a pure note-response
  entry, but it wrote explicit `null` instead of leaving the key absent — `.optional()`
  only accepts the key being MISSING, not present-with-`null`, so this failed the
  ENTIRE batch (`invalid_type: expected string, received null`) as soon as team
  strategy notes started regularly producing note-only entries. Fixed across every
  agent (`waiver-research.ts`, `roster-analysis.ts`, `trade-evaluation.ts`,
  `trade-suggestions.ts`, `news-monitoring.ts`) and `lib/chat.ts` — every currently
  `.optional()` field in a Zod schema passed to `generateJSON` should be `.nullish()`
  instead, since existing consumer code already does truthy checks (`if (r.addPlayer)`)
  that treat `null` and `undefined` identically, so this is a safe blanket fix with no
  downstream changes needed. Apply this to any future structured-output schema too.
- **Giving an agent more context (player notes, team strategy) can make it MORE
  hedgy, not more decisive — watch for this.** Real user-reported regression: right
  after wiring `playerNotes`/`teamStrategyNotes` into `waiver-research.ts`, every
  recommendation degraded into "monitor X" / "droppable if a need emerges" instead of
  committing to a real add/drop call — the model was using the extra context as an
  excuse to just validate the user's stance rather than still doing the work of
  finding the best move. Fixed via `buildCoachDirective()` in
  `lib/agents/shared.ts` (spliced onto every agent's system prompt) plus tightening
  `waiver-research.ts`'s note-response carve-out so it's the fallback when nothing
  beats the current player, not the default whenever a note exists. Re-verified live:
  went from 4/4 recommendations with no addPlayer/dropCandidate at all, to a real
  "Drop Justin Fields, add Dohnte Meyers" pairing plus decisive, reasoned holds for
  the rest. Lesson for any future agent: adding a "the user already told you X"
  signal to a prompt needs an explicit "use this to make a SHARPER call, not a softer
  one" counter-instruction, or the model will default to just agreeing.
- **Every `generateJSON` call's `prompt` must spell out the exact return JSON shape
  (key names included), not just describe intent in `system`.** Real bug, live:
  `waiver-research.ts`'s discovery-name-extraction call only said "extract player
  names" in `system` with no `Return JSON: {...}` in `prompt` — the model invented its
  own key (`nfl_players_mentioned` instead of the schema's `playerNames`) and failed
  validation on every single run, silently contributing zero discovery candidates
  (caught only because the `if (!extractResult.ok)` branch now logs a warning — it had
  no logging before the fix, so this had been silently broken since it was written).
  Every other `generateJSON` call in this codebase already includes an explicit
  `Return JSON: { "field": type, ... }` inside `prompt` — this was the one exception,
  and it broke exactly the way you'd expect. Any new `generateJSON` call must follow
  the same pattern, no exceptions, even for what looks like a small one-off extraction
  call.
- **Waiver-research discovery pass (FR13f) surfaces candidates Sleeper's trending-add
  list can't** — by definition, "trending" only shows players the crowd has ALREADY
  caught onto. `waiver-research.ts` now also runs one open-ended Perplexity query per
  run ("best waiver-wire pickups... under-the-radar... not yet on trending lists"),
  extracts named players via `generateJSON` (see the bug above), and resolves each
  against the real `players` table (`.ilike` + `fuzzyMatchName`, never trusted as
  free text) before it's ever shown to the main reasoning call — same verification
  discipline as trending/watchlist candidates. Also pulls Sleeper's trending-DROP data
  (`getTrendingPlayers("drop", ...)`, previously fetched but unused) as corroborating
  signal: a bench player also seeing platform-wide drops strengthens the case for
  actually dropping them; a candidate ADD also seeing drops is flagged as worth a
  second look (bye week vs. real bad news). Both are best-effort — neither failure
  blocks the run. Live-verified: a discovery-surfaced player (Keon Coleman) and a
  watchlist player both received real, reasoned evaluation in the same batch as
  trending-sourced candidates.
- **`roster_players` sync only ever upserted — it never pruned a player who left the
  roster.** Real user-reported bug: dropped a player for real in Sleeper, re-ran sync,
  the player still showed up here. Root cause: `upsert(rosterPlayerRows, ...)` only
  adds/updates rows for players CURRENTLY on the roster — a departed player isn't
  represented as any row to upsert, so their old row just sits there forever untouched.
  Fixed in `lib/sleeper-sync.ts`: after the upsert, diff the current
  `roster.players` id list against the existing `roster_players` rows for that roster
  and delete whatever's left over (stale ids), per roster, every sync. Diffed in app
  code rather than a raw SQL `NOT IN` to avoid string-escaping a player-id list.
  Live-verified: re-ran sync after a real Fields-for-Meyers move, Fields is now fully
  gone from `roster_players`, not just superseded. Any future table that mirrors a
  Sleeper list (not just adds to it) needs the same prune-after-upsert pattern, not
  upsert alone.
- **Manual "Refresh from Sleeper" button** (`components/refresh-button.tsx`,
  `app/(app)/actions.ts`'s `refreshFromSleeper`) — the app otherwise only pulls fresh
  Sleeper state on the daily cron schedule, so a real move made directly in Sleeper
  doesn't show up here until the next scheduled run. This button calls the exact same
  `syncLeague()` the cron route calls, just invoked directly (no `CRON_SECRET` needed —
  it only runs from a Server Action embedded in an already-authenticated page). On
  Dashboard and Roster pages. A refresh also auto-matches any new real transaction
  against pending waiver recommendations (`findMatchingWaiverRecommendation`) and
  marks the matched one `followed` — so executing a suggested add/drop and then
  refreshing also clears it off the pending waiver list, not just updates the roster.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code.
- Follow ALL rules exactly as documented.
- When in doubt, prefer the more restrictive option.
- Update this file if new patterns emerge.

**For Humans:**
- Keep this file lean and focused on agent needs.
- Update when technology stack changes.
- Review periodically for outdated rules.
- Remove rules that become obvious over time.

Last Updated: 2026-08-29 (rev 6)
