import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, getAppUserId } from "@/lib/supabase/service";
import type { Result } from "@/lib/sleeper";

export interface AgentPlayer {
  sleeperPlayerId: string;
  fullName: string;
  position: string | null;
  team: string | null;
  status: string | null;
  isStarter: boolean;
  /** e.g. "QB", "RB", "FLEX", "SUPER_FLEX", "K", "BN" — the actual lineup slot, not
   *  just the player's position (a FLEX slot holds a WR/RB/TE, for example). */
  rosterSlot: string | null;
}

export interface WatchlistPlayer {
  sleeperPlayerId: string;
  fullName: string;
  position: string | null;
  team: string | null;
  status: string | null;
  /** Why the user is tracking them (e.g. "handcuff if Achane gets hurt"), if given. */
  note: string | null;
}

export interface AgentContext {
  db: ReturnType<typeof createServiceClient>;
  userId: string;
  leagueId: string; // DB id, not Sleeper's
  scoringSettings: Record<string, number> | null;
  rosterPositions: string[] | null;
  ownRosterId: string;
  /** Sleeper's own numeric roster id (not our DB uuid) — needed to match trade
   *  transactions, which key everything by Sleeper's roster_id. */
  ownSleeperRosterId: number;
  ownRosterPlayers: AgentPlayer[];
  /**
   * sleeperPlayerId -> the user's own stated reasoning for holding that player (e.g.
   * "handcuff in case Mahomes gets hurt"). Agents must explicitly address any note
   * that applies to a player they're reasoning about — confirm it holds up or push
   * back with specific counter-reasoning — never silently ignore it.
   */
  playerNotes: Map<string, string>;
  /**
   * Standing, team-wide roster-construction directives the user has given via chat
   * (e.g. "I'm fine running only 2 QBs", "OK trading Andrews/Shakir/Coker") — distinct
   * from playerNotes, which is reasoning tied to ONE specific player. Most recent
   * first. Every agent that reasons about roster construction or who to add/drop/
   * trade should treat these as real constraints, not suggestions to weigh loosely.
   */
  teamStrategyNotes: string[];
  /** Free agents the user wants tracked even when not this week's top trending-add. */
  watchlist: WatchlistPlayer[];
}

/**
 * Loads a roster's players joined with cached player info (name/position/team/status).
 * Accepts any Supabase client — the service client (cron/agents) or the session client
 * (Server Components, RLS-scoped to the logged-in user) both work here.
 */
export async function loadRosterPlayers(
  db: SupabaseClient,
  rosterId: string,
): Promise<Result<AgentPlayer[]>> {
  const { data: rosterPlayers, error: rpError } = await db
    .from("roster_players")
    .select(
      "sleeper_player_id, is_starter, roster_slot, players(full_name, position, team, status)",
    )
    .eq("roster_id", rosterId);

  if (rpError) {
    return { ok: false, error: `Failed to load roster players: ${rpError.message}` };
  }

  const players: AgentPlayer[] = (rosterPlayers ?? []).map((rp) => {
    const player = Array.isArray(rp.players) ? rp.players[0] : rp.players;
    return {
      sleeperPlayerId: rp.sleeper_player_id as string,
      fullName: (player?.full_name as string | undefined) ?? "Unknown",
      position: (player?.position as string | undefined) ?? null,
      team: (player?.team as string | undefined) ?? null,
      status: (player?.status as string | undefined) ?? null,
      isStarter: rp.is_starter as boolean,
      rosterSlot: (rp.roster_slot as string | undefined) ?? null,
    };
  });

  return { ok: true, data: players };
}

/**
 * Loads everything an agent (or the chat handler) needs about the user's league/roster
 * once `db` and `userId` are already known — split out from `loadAgentContext` so the
 * chat page can reuse the exact same loading logic through the session-scoped client
 * (real `auth.uid()`, RLS-enforced) instead of the service-role client cron uses.
 */
export async function loadLeagueRosterContext(
  db: SupabaseClient,
  userId: string,
): Promise<Result<Omit<AgentContext, "db" | "userId">>> {
  const { data: league, error: leagueError } = await db
    .from("leagues")
    .select("id, scoring_settings, roster_positions")
    .eq("user_id", userId)
    .single();

  if (leagueError || !league) {
    return {
      ok: false,
      error: `No synced league found — run sync-league first (${leagueError?.message})`,
    };
  }

  const { data: roster, error: rosterError } = await db
    .from("rosters")
    .select("id, sleeper_roster_id")
    .eq("league_id", league.id)
    .eq("is_own_team", true)
    .single();

  if (rosterError || !roster) {
    return {
      ok: false,
      error: `Own roster not found — check SLEEPER_USERNAME matches a roster owner (${rosterError?.message})`,
    };
  }

  const rosterPlayersResult = await loadRosterPlayers(db, roster.id);
  if (!rosterPlayersResult.ok) return rosterPlayersResult;
  const ownRosterPlayers = rosterPlayersResult.data;

  const { data: noteRows } = await db
    .from("player_notes")
    .select("sleeper_player_id, note")
    .eq("user_id", userId);
  const playerNotes = new Map(
    (noteRows ?? []).map((n) => [n.sleeper_player_id as string, n.note as string]),
  );

  const { data: strategyRows } = await db
    .from("team_strategy_notes")
    .select("note")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  const teamStrategyNotes = (strategyRows ?? []).map((r) => r.note as string);

  const { data: watchlistRows } = await db
    .from("watchlist_players")
    .select("sleeper_player_id, note, players(full_name, position, team, status)")
    .eq("user_id", userId);
  const watchlist: WatchlistPlayer[] = (watchlistRows ?? []).map((row) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;
    return {
      sleeperPlayerId: row.sleeper_player_id as string,
      fullName: (player?.full_name as string | undefined) ?? "Unknown",
      position: (player?.position as string | undefined) ?? null,
      team: (player?.team as string | undefined) ?? null,
      status: (player?.status as string | undefined) ?? null,
      note: (row.note as string | null) ?? null,
    };
  });

  return {
    ok: true,
    data: {
      leagueId: league.id,
      scoringSettings: league.scoring_settings as Record<string, number> | null,
      rosterPositions: league.roster_positions as string[] | null,
      ownRosterId: roster.id,
      ownSleeperRosterId: roster.sleeper_roster_id as number,
      ownRosterPlayers,
      playerNotes,
      teamStrategyNotes,
      watchlist,
    },
  };
}

/**
 * Loads the shared context every MVP agent needs: the app's one league, the user's
 * own roster, and that roster's players joined with cached player info. Cron-only —
 * uses the service-role client, so it must run with FFC_USER_ID set.
 */
export async function loadAgentContext(): Promise<Result<AgentContext>> {
  let userId: string;
  let db: ReturnType<typeof createServiceClient>;
  try {
    userId = getAppUserId();
    db = createServiceClient();
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  const contextResult = await loadLeagueRosterContext(db, userId);
  if (!contextResult.ok) return contextResult;

  return { ok: true, data: { db, userId, ...contextResult.data } };
}

/**
 * Formats `ctx.teamStrategyNotes` as a prompt block, shared verbatim by every agent so
 * the "treat these as real constraints" instruction reads identically everywhere.
 * Returns "" when there are none, so callers can splice it in unconditionally.
 */
export function buildTeamStrategySummary(teamStrategyNotes: string[]): string {
  if (teamStrategyNotes.length === 0) return "";
  return (
    `\n\nStanding directives the user has given about their team strategy — treat ` +
    `these as real constraints on your recommendations, not loose suggestions ` +
    `(most recent first):\n` +
    teamStrategyNotes.map((n) => `- ${n}`).join("\n")
  );
}

/**
 * The house "voice" for every agent that talks directly to the user — added after
 * real feedback that recommendations had drifted into hedging ("monitor", "keep an
 * eye on") instead of committing to a clear call, especially once player/team-
 * strategy notes gave the model an easy out to just validate the user's stance
 * instead of still doing the work of finding the best move. This is a TONE directive,
 * layered on top of — never a replacement for — the correctness rules each agent
 * already states (never fabricate a claim, ground depth-chart statements in real
 * research, etc.).
 */
export function buildCoachDirective(): string {
  return (
    "\n\nTONE: You're this user's fantasy football coach, not a hedge-everything " +
    "assistant, and their season is on the line. Be direct and decisive — when the " +
    "data supports a real move, say so plainly and with urgency ('Drop X, add Y — " +
    "here's why this pays off in six weeks'), never a soft 'you might want to " +
    "monitor this.' Every recommendation needs one clear bottom-line directive up " +
    "front — what to actually do this week — not buried under qualifiers. If the " +
    "honest answer really is 'nothing worth doing,' say that plainly once and move " +
    "on — don't pad a non-move out with vague caution just to sound thorough. When " +
    "you recommend a drop, make the real case for why the replacement's long-term " +
    "value beats what's being given up, not just this week. The user telling you " +
    "what they're open to trading or dropping is you being handed a green light to " +
    "make a SHARPER call, not a reason to hedge more — if they said they're fine " +
    "dropping someone, don't keep waffling on whether to, tell them when and why."
  );
}

/**
 * Replaces this week's pending recommendations for a category with a fresh batch —
 * keeps re-running an agent idempotent instead of accumulating duplicate rows.
 * Recommendations the user already acted on (followed/not_followed/dismissed) are
 * left untouched.
 *
 * `payloadTypeEquals`: when TWO agents share the same `category` but are otherwise
 * unrelated batches (trade-evaluation's real offers vs. trade-suggestions' proactive
 * ideas both write category "trade"), pass this to scope the delete to only rows with
 * a matching `payload.type` — otherwise one agent's run would silently wipe out the
 * other's rows on every re-run, since a plain category+week delete doesn't
 * distinguish them.
 */
export async function replacePendingRecommendations(
  db: AgentContext["db"],
  args: {
    userId: string;
    leagueId: string;
    category: string;
    week: number | null;
    payloadTypeEquals?: string;
    rows: Array<{
      title: string;
      reasoning: string;
      sources?: Array<{ title: string; url: string }>;
      payload: Record<string, unknown>;
    }>;
  },
): Promise<Result<number>> {
  let deleteQuery = db
    .from("recommendations")
    .delete()
    .eq("user_id", args.userId)
    .eq("league_id", args.leagueId)
    .eq("category", args.category)
    .eq("status", "pending")
    .eq("week", args.week);
  if (args.payloadTypeEquals) {
    deleteQuery = deleteQuery.contains("payload", { type: args.payloadTypeEquals });
  }
  const { error: deleteError } = await deleteQuery;

  if (deleteError) {
    return { ok: false, error: `Failed to clear old recommendations: ${deleteError.message}` };
  }

  if (args.rows.length === 0) return { ok: true, data: 0 };

  const { error: insertError } = await db.from("recommendations").insert(
    args.rows.map((row) => ({
      user_id: args.userId,
      league_id: args.leagueId,
      category: args.category,
      week: args.week,
      title: row.title,
      reasoning: row.reasoning,
      sources: row.sources ?? [],
      payload: row.payload,
    })),
  );

  if (insertError) {
    return { ok: false, error: `Failed to insert recommendations: ${insertError.message}` };
  }

  return { ok: true, data: args.rows.length };
}
