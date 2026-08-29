---
stepsCompleted: [1, 2, 3, 4, 7, 8, 9, 10, 11]
inputDocuments: []
workflowType: 'prd'
lastStep: 11
project_name: 'Fantasy Football Copilot'
user_name: 'Zimrri'
date: '2026-08-28'
---

# Product Requirements Document - Fantasy Football Copilot

**Author:** Zimrri
**Date:** 2026-08-28

## Executive Summary

Fantasy Football Copilot is a personal, AI-assisted web application that helps its owner
manage a competitive fantasy football team without the multi-hour weekly time investment
of listening to podcasts and watching YouTube breakdowns. The app connects to the owner's
live Sleeper league ("Cockmans" — 12-team, Superflex, 2QB scoring) via Sleeper's public
read API, and uses a coordinated multi-agent AI system to do the research and analysis
that would otherwise consume that time, surfacing clear, actionable recommendations each
week. It will run locally to start, with a path to deployment on Vercel, backed by
Supabase for data persistence.

### What Makes This Special

Rather than a single chatbot or a static dashboard, the product is built around
specialized agents working together — one focused on waiver-wire research, one on
roster/matchup analysis, one on trade evaluation, and one on news/injury/social
monitoring — coordinating to turn what used to be hours of manual research into a
short, weekly set of decisions the owner can act on in minutes. The goal isn't just
information delivery; it's replacing a losing season's worth of missed research with a
system that never misses a beat, even when its owner doesn't have time to watch.

## Project Classification

**Technical Type:** web_app (browser-based now; PWA-style mobile access + notifications
in a later phase)
**Domain:** general (fantasy sports — no regulatory/compliance domain), though the
product carries meaningful technical complexity from multi-agent orchestration and
several live data integrations (Sleeper, player stats, news/social) that we'll dig into
in the Project-Type Deep Dive and Innovation Discovery steps
**Complexity:** Low domain-regulatory complexity, Medium technical/integration
complexity

## Success Criteria

### User Success

- No more scrambling every Sunday to figure out who to start, sit, or add — the app
  tells you clearly, ahead of time, what to do.
- The app catches things before they cost you: flags a hot waiver pickup before your
  league-mates grab him, flags when a player should be benched (injury/inactive), and
  talks you out of a bad trade.
- Decisions come from the app's analysis instead of cramming hours of podcasts and
  YouTube the night before.

### Business Success (Personal ROI)

- Don't lose this season — specifically avoid losing the way you lost last year (missed
  research, bad start/sit calls, missed waiver windows).
- Weekly time spent on fantasy research drops from several hours of podcasts/YouTube to
  a short weekly check-in with the app.
- The tool becomes a trusted weekly habit for the full season, not something you stop
  using after week 3.

### Technical Success

- Sleeper league data (roster, matchups, transactions, scoring settings) stays in sync
  via the public read API, reflecting current league state.
- Waiver and start/sit recommendations arrive with enough lead time to act before
  waiver processing and lineup lock each week.
- The multi-agent system runs reliably enough to be trusted week over week.

### Measurable Outcomes

- Season record improves relative to last year.
- Weekly research time drops from hours to well under 30 minutes reviewing the app's
  output.
- No missed waiver windows and no "forgot to bench an injured player" losses once the
  app is in weekly use.

## Product Scope

### MVP - Minimum Viable Product

- Sleeper league sync (read-only) for "Cockmans" — rosters, matchups, transactions,
  league/scoring settings.
- Waiver research agent — surfaces and ranks available free agents worth adding.
- Roster & matchup analysis agent — start/sit recommendations, injury/bye flagging,
  opponent-aware analysis.
- Clear, actionable weekly output, not raw data dumps.
- Runs locally, backed by Supabase.

### Growth Features (Post-MVP)

- Trade evaluation agent — assesses incoming/outgoing trade offers and proactively
  suggests beneficial trades.
- News & injury/social monitoring agent — ingests breaking news and feeds it to the
  other agents in near-real time.

### Vision (Future)

- Deploy to Vercel for anywhere-access.
- Mobile-friendly experience with push notifications (e.g., "player X is now
  questionable," "waiver window closing").
- Revisit automated Sleeper actions (adds/drops/trades) if a supported path is ever
  found — MVP and Growth stay recommend-only.

## User Journeys

**Journey 1: The Saturday Night Save (Primary — Happy Path, MVP)**

Last year, Zimrri spent his weekends scrambling — Sunday mornings burned scrolling
podcasts and hot-take videos trying to decide who to start, second-guessing every close
call right up to kickoff. This year, Saturday night he opens Fantasy Football Copilot
instead. The roster & matchup analysis agent has already done the work: clear start/sit
calls for every borderline spot, weighted against this week's actual opponent. A close
decision at flex that would've eaten twenty minutes of debate is resolved in one glance,
with the reasoning shown. He sets his lineup in five minutes and closes the laptop —
no scrambling, no doubt.

**Journey 2: Winning the Waiver Race (Primary — Happy Path, MVP)**

A backup running back explodes on Monday Night Football while Zimrri's asleep before a
workday. By the time he'd normally think to check, half the league would already have
submitted a claim. Instead, the waiver research agent flagged the breakout that night and
had a ranked pickup recommendation waiting before FAAB processing on Wednesday. Zimrri
submits the claim on his lunch break and wins the roster spot that used to go to whoever
watched the most YouTube recaps.

**Journey 3: The Bad Trade Near-Miss (Primary — Edge Case, Growth)**

A league-mate sends a trade offer that looks like a win at first glance — more name
value coming back. The trade evaluation agent breaks it down against Zimrri's actual
roster construction and the league's Superflex/2QB scoring, and flags that it actually
weakens his team at the position he can least afford to lose. Zimrri declines, avoiding
a mistake he might have made under a five-minute podcast-fueled panic last year.

**Journey 4: The Wednesday Injury Scramble (Primary — Edge Case, Growth)**

A starter gets hurt in practice on a Wednesday, days before Zimrri would normally hear
about it. The news/injury monitoring agent picks up the report almost immediately and
flags the roster impact, and the roster analysis agent already has a replacement
recommendation ready. By Sunday, it's a non-event instead of a last-minute panic.

**Journey 5: First-Time Setup (Onboarding, MVP)**

Zimrri connects his Sleeper account and league ("Cockmans") for the first time. The app
pulls in his roster, league settings, and scoring rules automatically — no manual data
entry. Before trusting it with real decisions, he spends his first week comparing its
recommendations against his own gut calls, and by week two he's confident enough to just
follow them.

### Journey Requirements Summary

- **Journey 1** → roster/matchup analysis engine, start/sit reasoning surfaced (not just
  a verdict), opponent-aware scoring, a weekly summary view.
- **Journey 2** → waiver research agent, ranked pickup recommendations, timing awareness
  around FAAB/waiver processing windows, notification/reminder before the window closes.
- **Journey 3** → trade evaluation agent, roster-construction-aware analysis, scoring-
  format-aware valuation (Superflex/2QB), accept/decline-style recommendation with
  reasoning.
- **Journey 4** → news/injury monitoring agent, near-real-time ingestion, automatic link
  between a news event and its roster impact, proactive (not on-demand) alerting.
- **Journey 5** → Sleeper account/league connection flow, automatic roster/settings
  sync, a "trust-building" first-week experience (showing its reasoning, not just verdicts).

## Web App Specific Requirements

### Project-Type Overview

Fantasy Football Copilot is a single-page web application built for one user (not a
public/multi-tenant product), so several standard web-app concerns are simplified or
not applicable — there's no SEO surface, no broad browser-compatibility matrix, and no
public accessibility compliance target.

### Technical Architecture Considerations

- **Rendering model:** SPA — dashboard-style experience for weekly recommendations and
  status.
- **Real-time needs:** No hard real-time requirement for MVP; periodic refresh (a few
  times a day) is sufficient. Near-real-time push for breaking injury news is a
  Growth-phase nice-to-have (tied to the news/social monitoring agent), not a blocker.
- **Browser support:** Whatever browser Zimrri personally uses day to day — no legacy
  browser support needed.
- **SEO strategy:** Not applicable — private, single-user tool, not meant to be publicly
  discoverable or indexed.
- **Accessibility level:** Baseline only; no dedicated compliance target since this is a
  personal tool with one known user.

### Data Sourcing & Cost Constraints (Critical Requirement)

- **Cost is a first-class constraint.** Total ongoing spend should stay low —
  meaningfully less than the ~$100/season already spent on the league itself. No single
  paid API tier (e.g., X/Twitter's paid API) is acceptable if it alone would cost
  $100+/month.
- **News & social data:** Use free/cheap sources instead of the paid X/Twitter API.
  **Decision revised during implementation:** the RSS/Reddit plan below was swapped for
  **Perplexity's Sonar API** (search-grounded LLM, cheapest "sonar" tier, roughly
  $1/1000 requests + token costs — a few cents to low dollars/month at this app's
  cadence, well under the cost ceiling). Perplexity returns cited sources with every
  answer, which directly serves the requirement (added during implementation) that
  recommendations show **where** information came from, not just why. It's already
  wired into both MVP agents (`lib/perplexity.ts`), not deferred to Growth phase — see
  Functional Requirements below. Twitter/X's own paid API integration is still deferred
  indefinitely. *(Original plan, superseded: RSS feeds from ESPN, NFL.com, FantasyPros,
  Rotoworld, and/or Reddit's free API for community-sourced signal.)*
- **Player/stats data & Sleeper sync:** Free via Sleeper's public read API (confirmed
  working, no auth, no cost) and Sleeper's free player database endpoint.
- **LLM/agent costs:** Use pay-as-you-go model access (Claude API and/or OpenRouter) to
  keep model choice flexible and cost-optimized — cheaper/smaller models for
  high-frequency or low-complexity agent tasks, reserving stronger models only where
  the analysis genuinely benefits from it. Avoid architectures that require constant,
  expensive LLM calls (e.g., don't re-run full analysis on every page load — cache and
  batch on a sensible schedule, like once per day or around key windows such as waiver
  processing and lineup lock).

### Implementation Considerations

- Architecture should treat "stay cheap" as a design constraint from day one, not an
  optimization to revisit later — this shapes how often agents run, what they cache,
  and which data sources get used.
- Free-tier data sources (RSS/Reddit/Sleeper) may be less structured or less timely than
  paid alternatives; the news-monitoring agent (Growth phase) should be designed to
  degrade gracefully rather than assume premium data quality.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-Solving MVP — solve the core Sunday-scramble and missed-waiver
problem with the smallest reliable feature set, rather than building a broad platform
before proving the core loop works.
**Resource Requirements:** Solo builder (Zimrri), assisted by AI coding tools. No team,
no budget for contractors — every scoping decision favors low build effort and low
ongoing cost over completeness.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:** Journey 1 (Saturday Night Save), Journey 2 (Winning
the Waiver Race), Journey 5 (First-Time Setup).

**Must-Have Capabilities:**
- Sleeper league sync (read-only): rosters, matchups, transactions, league/scoring
  settings — via the confirmed free public API.
- Waiver research agent: ranks available free agents worth adding, refreshed on a
  schedule (not real-time).
- Roster & matchup analysis agent: start/sit recommendations with visible reasoning,
  opponent-aware.
- A simple weekly view: what to do this week, in plain terms.
- Runs locally, Supabase-backed.

### Post-MVP Features

**Phase 2 (Growth):**
- Trade evaluation agent (Journey 3) — assess and proactively suggest trades.
- News/injury monitoring agent (Journey 4) — free/cheap sources (RSS, Reddit), feeding
  the other agents.

**Phase 3 (Vision/Expansion):**
- Deploy to Vercel.
- Mobile-friendly PWA with push notifications.
- Revisit automated Sleeper actions if a supported path emerges.

### Risk Mitigation Strategy

**Technical Risks:** The biggest risk is agent-orchestration complexity and reliance on
free-tier data sources that may be inconsistent. Mitigation: start with two focused
agents (waiver + roster/matchup) instead of four, run them on a schedule (e.g., daily,
plus ahead of lineup lock) instead of real-time, and keep the LLM cost model
pay-as-you-go so complexity can grow without a fixed cost commitment.

**"Market" (Trust) Risk:** The real risk isn't market adoption, it's whether Zimrri
actually trusts and uses the recommendations. Mitigation: Journey 5's built-in
trust-building period — show reasoning, not just verdicts, and expect a comparison
period against gut instinct before fully relying on it.

**Resource Risks:** Solo build with limited free time is the core constraint the whole
project exists to solve — so scope is deliberately minimal at MVP, reusing free APIs
(Sleeper, RSS/Reddit) instead of building custom infrastructure, to get something usable
in front of Zimrri as fast as possible during the season.

## Functional Requirements

### League Connection & Sync (MVP)

- FR1: User can connect their Sleeper account and league to the app during setup.
- FR2: System can retrieve and store the user's roster, league settings, and scoring
  rules from Sleeper.
- FR3: System can retrieve current league matchups, opponent rosters, and transaction
  history from Sleeper.
- FR4: System can refresh synced league data on a recurring schedule without manual
  action from the user.

### Roster & Matchup Analysis (MVP)

- FR5: User can view start/sit recommendations for their full roster for the upcoming
  week.
- FR6: User can see the reasoning behind each start/sit recommendation, not just a
  verdict.
- FR6a *(added during implementation)*: User can see the source(s) — where the
  information came from, not just why — behind each start/sit recommendation, via a
  Perplexity research step grounding the agent's reasoning in current, cited news.
- FR7: System can factor the upcoming opponent's matchup into roster recommendations.
- FR8: System can flag roster players who are injured, on bye, or otherwise unavailable.
- FR9: User can view their team's weekly outlook in a single, digestible summary.

### Waiver Wire Research (MVP)

- FR10: User can view a ranked list of available free agents worth adding.
- FR11: System can prioritize waiver recommendations based on the user's roster needs
  and the league's scoring format.
- FR12: User can see the reasoning behind each waiver recommendation.
- FR12a *(added during implementation)*: User can see the source(s) behind each waiver
  recommendation, via the same Perplexity research step.
- FR13: System can surface waiver recommendations with enough lead time to act before
  the league's waiver processing window.
- FR13a *(added during implementation, user-requested)*: When the user's roster is
  full, every waiver-add recommendation must name a specific bench player to drop —
  computed from real roster-size data (not left to the LLM to infer), and verified
  against the actual bench (fuzzy-matched, logged if unresolvable) rather than trusted
  blindly.
- FR13b *(added during implementation, user-requested)*: User can attach their own
  written reasoning to any roster player (e.g., "handcuff in case Mahomes gets hurt"),
  via a note editor on every lineup row. Any agent that could recommend dropping or
  benching that player must explicitly engage with the note — confirm it still holds
  or explain specifically why it doesn't — rather than silently overriding the user's
  stated intent. `player_notes` table, `ctx.playerNotes` in `lib/agents/shared.ts`,
  wired into `waiver-research.ts` and `roster-analysis.ts`. Verified live: a real note
  on Justin Fields (Mahomes handcuff) produced a recommendation confirming the
  reasoning was sound and telling the user to keep him.
- FR13c *(added during implementation, user-requested)*: Waiver research must ground
  every factual claim about a player's current depth-chart role in real, cited
  research — covering BOTH the trending-add candidates AND the bench players being
  evaluated as a drop, not just one side. Fixed a real user-reported hallucination
  (a bench WR2 was described as a "WR4/5" from stale LLM recall, with sources shown
  that were actually about unrelated players). Re-verified live afterward with a
  correct, sourced depth-chart claim.
- FR13d *(added during implementation, user-requested)*: User can review every real
  waiver/free-agent move they've made in Sleeper, and once enough weeks have been
  played, see a real point comparison (per the league's own scoring format) between
  who was added and who was dropped — "was this move actually worth it." Each move is
  auto-matched (fuzzy name match) to the pending waiver recommendation it acted on, if
  any, so the user can see the AI's original reasoning next to the real outcome; a
  matched recommendation is also auto-marked "followed." New `/moves` page,
  `roster_moves` table (synced alongside trades from Sleeper's transactions endpoint),
  `lib/waiver-moves.ts` (matching + point-outcome computation), real per-player weekly
  stats from Sleeper's `/stats/nfl/regular/{season}/{week}` endpoint. Never fabricates
  an outcome before it's knowable — shows "too early to tell" until at least one full
  week has completed since the move, never a false 0-0 tie.
- FR13e *(added during implementation, user-requested)*: User can maintain a
  free-agent watchlist — players worth tracking even when they aren't this week's top
  trending-add (e.g. a name mentioned once in a prior recommendation that didn't make
  the cut). `waiver-research.ts` evaluates every watchlist player every run regardless
  of trending status — the whole point of a watchlist is catching a player before the
  rest of the league bids them up. `/waivers` page, `watchlist_players` table, search
  against the already-synced `players` cache (no external lookup needed).
- FR13f *(added during implementation, user-requested)*: Waiver research isn't
  limited to Sleeper's trending-add list — an open-ended Perplexity research pass
  each run surfaces additional under-the-radar candidates before they show up as an
  add-count spike, resolved against the real player database before ever reaching
  the recommendation step (same anti-fabrication discipline as every other candidate
  source). Sleeper's trending-DROP data is also factored in as corroborating signal
  for hold/drop calls. Live-verified: a discovery-surfaced player and a watchlist
  player both received real evaluation in the same batch as trending-sourced ones.
- FR13g *(added during implementation, user-requested)*: Recommendations must commit
  to a decisive call ("Add X, drop Y" / "Hold X, here's why") rather than hedging
  ("monitor", "droppable if a need emerges") — a real regression was found and fixed
  where adding more context (player notes, team strategy) made the agent MORE
  hedgy, not more decisive, since it used the extra context as an excuse to just
  validate the user's stance instead of still finding the best move. Fixed via a
  shared `buildCoachDirective()` tone applied to every recommendation-generating
  agent.

### Trade Evaluation (Growth — BUILT)

- FR14: User can submit a trade offer (received or proposed) for evaluation. *(Built as
  automatic detection of real pending offers from Sleeper's transactions endpoint —
  more useful than a manual entry form, and directly satisfies "received.")*
- FR15: System can evaluate a trade's impact on the user's roster construction and
  scoring format. Done — `lib/agents/trade-evaluation.ts`.
- FR16: System can recommend accepting, declining, or countering a trade offer, with
  reasoning. Done, plus a season-long outlook (a trade is even more permanent than a
  waiver drop).
- FR17: System can proactively suggest trade opportunities that would improve the
  user's team. Done — `lib/agents/trade-suggestions.ts`: computes each team's
  positional surplus/need from real roster composition (plain code, not an LLM guess),
  finds the best complementary partner across all 12 rosters, and synthesizes one
  concrete idea only when the numbers genuinely support it — verified live with real,
  well-reasoned output (correctly identified Superflex-format QB surplus after a
  reasoning bug — missing SUPER_FLEX context — was found and fixed).
- FR17a *(added during implementation, user-requested)*: Proposed trade ideas should
  lean toward the user's benefit while staying realistic enough the other team would
  plausibly accept — not a strictly "fair" 50/50 split. System prompt explicitly frames
  the agent as the user's advocate, not a neutral referee: offer the least valuable
  piece from the user's surplus that still gets the deal done, target the most valuable
  piece from the other team's need. Includes `mutualBenefitReasoning` so the pitch to
  the other team is still visible.

### News & Injury Monitoring (Growth — BUILT)

- FR18: System can ingest player news from free/low-cost sources. *(Revised during
  implementation: Perplexity's Sonar API, not RSS/Reddit — see Web App Specific
  Requirements.)* `lib/agents/news-monitoring.ts` — verified live with real output
  (specific injury details, HC statements, actionable roster impact notes).
- FR19: System can detect when a news event affects a rostered or targeted player. Done
  — scans the full roster (starters + bench), not just current-week starters.
- FR20: System can link a detected news event to its roster impact and surface it
  through the relevant recommendation. Done via `rosterImpact` on each news item; not
  yet cross-linked into start_sit/waiver/trade recommendations specifically (each
  category still reasons independently) — a possible future refinement, not required
  for the core capability to work.
- FR21: User can view a feed of recent news relevant to their roster and league. Done —
  `/news` page.

### Weekly Recommendations & Reporting (MVP)

- FR22: User can view a single weekly summary of all recommended actions (start/sit,
  waiver targets, trade flags).
- FR23: User can review the history of past recommendations and whether they were
  followed.

### Notifications & Mobile Access (Vision)

- FR24: User can receive a notification when a time-sensitive recommendation is ready
  (e.g., waiver window closing, injury update).
- FR25: User can access the app from a mobile device with a comparable experience to
  desktop.

### Cost & Data Source Management (Cross-cutting)

- FR26: System can operate using free or low-cost data sources without requiring
  expensive paid API tiers.
- FR27: System can select which AI model/provider to use per task, allowing cheaper
  models for routine analysis and stronger models where warranted.
- FR28: User can view league and roster data current as of the most recent sync.

### Team Strategy & Chat (Growth — BUILT, added during implementation, user-requested)

- FR29: User can converse with the copilot in natural language — ask questions about
  their roster and get answers grounded in real synced data, not just receive
  scheduled agent output. `/chat` page, `lib/chat.ts`, non-streaming (one Server Action
  round-trip per turn — a personal-use copilot doesn't need SSE plumbing for a
  few-second wait).
- FR30: Preferences and directives the user states in chat (about one specific player,
  or a team-wide roster-construction policy) are automatically extracted and persisted
  so every future agent run — waiver, roster analysis, trade evaluation, trade
  suggestions — factors them in, not just remembered within the chat itself. A
  per-player statement (e.g. "I'm OK trading Andrews") becomes a `player_notes` entry
  (the same mechanism as FR13b, now writable via chat as well as the roster UI); a
  team-wide policy (e.g. "I only want to keep 2 QBs") becomes a `team_strategy_notes`
  entry, read by every agent via a shared prompt block
  (`buildTeamStrategySummary`). Verified live end-to-end with the user's own real
  multi-directive message: correctly produced 4 player-note updates (including
  clearing one that the new message contradicted) and 1 team-strategy entry, and the
  next waiver-research run visibly acted on all of them with grounded, specific
  reasoning.

## Non-Functional Requirements

### Performance

- Weekly recommendations (waiver targets, start/sit calls) must be generated and ready
  before the relevant deadline — ahead of the league's waiver processing window and
  before Sunday lineup lock — not computed on-demand when the user happens to check.
- The weekly summary/dashboard view loads within a few seconds under normal personal-
  scale usage (single user, no concurrent load).

### Security

- Sleeper, Supabase, and any LLM provider (Claude/OpenRouter) API keys and credentials
  are stored securely — never committed to source control, never exposed to the client.
- No public sign-up or multi-user auth system is required for MVP (single known user),
  but once deployed to Vercel, access to the deployed app itself must be restricted
  (e.g., basic auth or a private deployment) so it isn't publicly reachable by default.
- Supabase data access is scoped to the single user, even pre-deployment, so the data
  model doesn't need rework if the app is ever shared or expanded later.

### Integration Reliability

- If Sleeper's API is temporarily unavailable, the system falls back to the last
  successfully synced data rather than failing outright.
- If a free news/RSS source is down or rate-limited, the news-monitoring agent skips
  that source gracefully rather than blocking other recommendations from being
  generated.
- LLM provider calls handle failures or rate limits with retry logic or fallback to an
  alternate model/provider rather than silently failing to produce a recommendation.

### Cost Efficiency

- Total monthly operating cost (LLM usage plus any paid services) stays well under the
  $100/season the user already spends on the league itself — ideally low-to-no cost for
  MVP.
- LLM/agent calls are batched and scheduled (e.g., once daily, ahead of key deadlines)
  rather than triggered on every user interaction, to keep costs predictable and low.
