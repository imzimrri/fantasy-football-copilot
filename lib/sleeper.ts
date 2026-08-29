import { z } from "zod";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function sleeperFetch<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<Result<T>> {
  try {
    const res = await fetch(`${SLEEPER_BASE}${path}`);
    if (!res.ok) {
      return { ok: false, error: `Sleeper ${path} returned ${res.status}` };
    }
    const json = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Sleeper ${path} response failed validation: ${parsed.error.message}`,
      };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    return { ok: false, error: `Sleeper ${path} request failed: ${String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Schemas — only the fields this app actually uses, not Sleeper's full shape.
// ---------------------------------------------------------------------------

const SleeperUserSchema = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
});

const SleeperLeagueSchema = z.object({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  scoring_settings: z.record(z.string(), z.number()),
  roster_positions: z.array(z.string()),
  settings: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

const SleeperRosterSchema = z.object({
  roster_id: z.number(),
  owner_id: z.string().nullable(),
  players: z.array(z.string()).nullable().optional(),
  starters: z.array(z.string()).nullable().optional(),
  settings: z
    .object({
      wins: z.number().optional(),
      losses: z.number().optional(),
      ties: z.number().optional(),
      fpts: z.number().optional(),
      fpts_against: z.number().optional(),
    })
    .optional(),
});

const SleeperLeagueUserSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable().optional(),
});

const SleeperMatchupSchema = z.object({
  roster_id: z.number(),
  matchup_id: z.number().nullable(),
  points: z.number().nullable().optional(),
});

const SleeperPlayerSchema = z.object({
  full_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  injury_status: z.string().nullable().optional(),
});

const SleeperPlayersMapSchema = z.record(z.string(), SleeperPlayerSchema);

const NflStateSchema = z.object({
  week: z.number(),
  season: z.string(),
  season_type: z.string(),
});

const TrendingPlayerSchema = z.object({
  player_id: z.string(),
  count: z.number(),
});

const SleeperTransactionSchema = z.object({
  transaction_id: z.string(),
  type: z.string(), // "trade" | "free_agent" | "waiver"
  status: z.string(), // "pending" | "complete" | "failed"
  roster_ids: z.array(z.number()),
  adds: z.record(z.string(), z.number()).nullable(),
  drops: z.record(z.string(), z.number()).nullable(),
  draft_picks: z.array(z.unknown()),
});

export type SleeperLeague = z.infer<typeof SleeperLeagueSchema>;
export type SleeperRoster = z.infer<typeof SleeperRosterSchema>;
export type SleeperLeagueUser = z.infer<typeof SleeperLeagueUserSchema>;
export type SleeperMatchup = z.infer<typeof SleeperMatchupSchema>;
export type SleeperPlayer = z.infer<typeof SleeperPlayerSchema>;
export type NflState = z.infer<typeof NflStateSchema>;
export type SleeperTransaction = z.infer<typeof SleeperTransactionSchema>;

// ---------------------------------------------------------------------------
// Public client functions
// ---------------------------------------------------------------------------

export function getUserByUsername(username: string) {
  return sleeperFetch(`/user/${encodeURIComponent(username)}`, SleeperUserSchema);
}

export function getLeague(leagueId: string) {
  return sleeperFetch(`/league/${leagueId}`, SleeperLeagueSchema);
}

export function getRosters(leagueId: string) {
  return sleeperFetch(`/league/${leagueId}/rosters`, z.array(SleeperRosterSchema));
}

export function getLeagueUsers(leagueId: string) {
  return sleeperFetch(`/league/${leagueId}/users`, z.array(SleeperLeagueUserSchema));
}

export function getMatchups(leagueId: string, week: number) {
  return sleeperFetch(
    `/league/${leagueId}/matchups/${week}`,
    z.array(SleeperMatchupSchema),
  );
}

export function getNflState() {
  return sleeperFetch(`/state/nfl`, NflStateSchema);
}

/** Transactions (trades, waivers, free-agent moves) for one week/round. */
export function getTransactions(leagueId: string, round: number) {
  return sleeperFetch(
    `/league/${leagueId}/transactions/${round}`,
    z.array(SleeperTransactionSchema),
  );
}

/**
 * Every NFL player's real fantasy stat line for one completed week — league-wide, not
 * scoped to any roster, keyed by sleeper_player_id. Includes precomputed
 * pts_ppr/pts_half_ppr/pts_std. This is what lets us retrospectively answer "did the
 * player I added actually outscore the player I dropped" with real Sleeper-computed
 * points instead of an LLM guess — schema is intentionally loose (values read
 * defensively at the call site) since the stat keys vary by position (kicker vs IDP vs
 * offense) and aren't worth modeling exhaustively here.
 */
export function getPlayerWeekStats(season: string, week: number) {
  return sleeperFetch(
    `/stats/nfl/regular/${season}/${week}`,
    z.record(z.string(), z.record(z.string(), z.unknown())),
  );
}

/**
 * Pure decision logic for `getCurrentFantasyWeek` — split out for unit testing without
 * a network call. Sleeper's `/state/nfl` reports whatever week the NFL itself is on,
 * INCLUDING preseason: during preseason (`season_type: "pre"`), `week` counts
 * preseason weeks (1-3ish), not the fantasy league's week. Confirmed live on
 * 2026-08-29: state returned `{ week: 3, season_type: "pre" }` while the fantasy
 * league's actual current week is 1 (season hasn't started) — using the raw value
 * mistagged every recommendation/schedule highlight as "week 3" during preseason.
 * Postseason (`season_type: "post"`) keeps the raw week numbering since fantasy
 * playoff weeks continue the same counter.
 */
export function resolveFantasyWeek(state: Pick<NflState, "week" | "season_type">): number {
  return state.season_type === "pre" || state.season_type === "off" ? 1 : state.week;
}

/**
 * Pure decision logic for the most recent FULLY completed fantasy week — i.e. one
 * whose stats are final, safe to use for retrospective point comparisons. Never the
 * current week (games may still be in progress, so a partial total would misread as a
 * final one) and never negative (preseason/off-season: nothing has been played yet).
 */
export function resolveLastCompletedWeek(state: Pick<NflState, "week" | "season_type">): number {
  if (state.season_type === "pre" || state.season_type === "off") return 0;
  return Math.max(0, state.week - 1);
}

/** The fantasy week to use for recommendations/schedule/matchups — see `resolveFantasyWeek`. */
export async function getCurrentFantasyWeek(): Promise<Result<number>> {
  const stateResult = await getNflState();
  if (!stateResult.ok) return stateResult;
  return { ok: true, data: resolveFantasyWeek(stateResult.data) };
}

/** The most recent fantasy week with final stats — see `resolveLastCompletedWeek`. */
export async function getLastCompletedWeek(): Promise<Result<number>> {
  const stateResult = await getNflState();
  if (!stateResult.ok) return stateResult;
  return { ok: true, data: resolveLastCompletedWeek(stateResult.data) };
}

/**
 * The full Sleeper player database (~5MB, all sports history). Fetch sparingly —
 * once per sync-league run is enough, not per-agent-call. Filter to skill positions
 * before writing to the `players` table.
 */
export function getAllPlayers() {
  return sleeperFetch(`/players/nfl`, SleeperPlayersMapSchema);
}

/** Positions this app cares about — filters Sleeper's full player dump down. */
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/**
 * Real-signal waiver targets: players being added across Sleeper platform-wide in the
 * lookback window, ranked by add count. This is what makes waiver-research grounded
 * instead of an LLM guessing across thousands of free agents with no recency signal.
 */
export function getTrendingPlayers(
  type: "add" | "drop" = "add",
  lookbackHours = 24,
  limit = 25,
) {
  return sleeperFetch(
    `/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`,
    z.array(TrendingPlayerSchema),
  );
}
