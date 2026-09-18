import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlayerWeekStats } from "@/lib/sleeper";
import type { Result } from "@/lib/sleeper";
import { fuzzyMatchName } from "@/lib/fuzzy-match";
import { cacheKey, getCached, setCached } from "@/lib/cache";

/**
 * Self-heals stale "add X" waiver recommendations: once X is actually on the user's
 * roster — whether they followed the suggestion exactly or made the move some other
 * way — the recommendation is moot and should stop showing as pending. Without this,
 * a pending waiver recommendation only clears via `findMatchingWaiverRecommendation`
 * catching the exact Sleeper transaction during sync (which requires the transaction
 * to have actually settled — a waiver claim doesn't process until the league's
 * waiver time), or via the next daily waiver-research run wholesale-replacing that
 * week's batch — up to 24h of showing a recommendation the user already acted on.
 * Called after every roster sync (manual refresh AND the daily cron, before
 * generating a fresh batch) so this clears as soon as the roster data does.
 */
export async function resolveStaleWaiverRecommendations(
  db: SupabaseClient,
  userId: string,
  leagueId: string,
  currentRosterNames: string[],
): Promise<void> {
  const { data: pending } = await db
    .from("recommendations")
    .select("id, payload")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .eq("category", "waiver")
    .eq("status", "pending");

  for (const rec of pending ?? []) {
    const addPlayer = (rec.payload as Record<string, unknown>).addPlayer as string | undefined;
    if (!addPlayer) continue;
    if (fuzzyMatchName(addPlayer, currentRosterNames)) {
      await db.from("recommendations").update({ status: "followed" }).eq("id", rec.id);
    }
  }
}

const STATS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — matches the rest of lib/cache.ts's callers.

/**
 * Finds the most recent pending waiver recommendation this real move plausibly acted
 * on, so the UI can show "you followed this suggestion" next to the AI's original
 * reasoning, and so the recommendation's own status gets set to "followed"
 * automatically instead of relying on the user to click a button for every waiver
 * move. Fuzzy-matched (player names from Sleeper vs. the LLM's payload strings rarely
 * line up character-for-character) against BOTH addPlayer and dropCandidate — a
 * single-field match (just the add, or just the drop) is accepted too, since the user
 * might follow the add but choose a different drop, or vice versa.
 */
export async function findMatchingWaiverRecommendation(
  db: SupabaseClient,
  args: {
    userId: string;
    leagueId: string;
    week: number;
    addedNames: string[];
    droppedNames: string[];
    beforeIso: string;
  },
): Promise<string | null> {
  const { data: candidates } = await db
    .from("recommendations")
    .select("id, payload, created_at")
    .eq("user_id", args.userId)
    .eq("league_id", args.leagueId)
    .eq("category", "waiver")
    .in("week", [args.week - 1, args.week, args.week + 1])
    .lte("created_at", args.beforeIso)
    .order("created_at", { ascending: false });

  if (!candidates || candidates.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const rec of candidates) {
    const payload = rec.payload as Record<string, unknown>;
    const addPlayer = payload.addPlayer as string | undefined;
    const dropCandidate = payload.dropCandidate as string | undefined;

    const addMatches = !!addPlayer && args.addedNames.some((n) => fuzzyMatchName(addPlayer, [n]));
    const dropMatches =
      !!dropCandidate && args.droppedNames.some((n) => fuzzyMatchName(dropCandidate, [n]));

    const score = (addMatches ? 1 : 0) + (dropMatches ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = rec.id as string;
    }
  }

  return bestScore > 0 ? bestId : null;
}

/** Picks the Sleeper stat field closest to this league's actual scoring format. */
export function pointsFieldForLeague(scoringSettings: Record<string, number> | null): string {
  const rec = scoringSettings?.rec;
  if (rec === 1) return "pts_ppr";
  if (rec === 0 || rec === undefined) return "pts_std";
  return "pts_half_ppr";
}

/** One completed week's league-wide player points, cached (stats don't change once a week is final). */
async function getWeekPoints(
  season: string,
  week: number,
  field: string,
): Promise<Record<string, number>> {
  const key = cacheKey(["sleeper-week-stats", season, String(week)]);
  const cached = await getCached<Record<string, unknown>>(key, STATS_CACHE_TTL_MS);
  let raw = cached;
  if (!raw) {
    const result = await getPlayerWeekStats(season, week);
    if (!result.ok) return {};
    raw = result.data as Record<string, unknown>;
    await setCached(key, raw);
  }
  const points: Record<string, number> = {};
  for (const [playerId, stats] of Object.entries(raw)) {
    const value = (stats as Record<string, unknown> | undefined)?.[field];
    if (typeof value === "number") points[playerId] = value;
  }
  return points;
}

export interface MovePlayerOutcome {
  sleeperPlayerId: string;
  fullName: string;
  totalPoints: number;
}

export interface MoveOutcome {
  /** 0 means no fully-completed week has elapsed since the move yet — every
   *  totalPoints below is 0 in that case; the UI should show "too early to tell,"
   *  not a real 0-0 tie. */
  weeksCounted: number;
  added: MovePlayerOutcome[];
  dropped: MovePlayerOutcome[];
  netPoints: number;
}

/**
 * Sums real fantasy points (per the league's own scoring format) for every added and
 * dropped player, from the move's week through the most recent COMPLETED week — never
 * the current in-progress one, since a partial week under- or over-states an
 * in-progress performance and would read as a false verdict. Player names are always
 * resolved and returned even when `weeksCounted` is 0, so the UI can show "you added X,
 * dropped Y — too early to tell" instead of nothing.
 */
export async function computeMoveOutcome(
  db: SupabaseClient,
  move: { week: number; adds: Record<string, unknown>; drops: Record<string, unknown> },
  season: string,
  lastCompletedWeek: number,
  scoringSettings: Record<string, number> | null,
): Promise<Result<MoveOutcome | null>> {
  const addedIds = Object.keys(move.adds ?? {});
  const droppedIds = Object.keys(move.drops ?? {});
  const allIds = [...addedIds, ...droppedIds];
  if (allIds.length === 0) return { ok: true, data: null };

  const { data: playerRows, error } = await db
    .from("players")
    .select("sleeper_player_id, full_name")
    .in("sleeper_player_id", allIds);
  if (error) return { ok: false, error: `Failed to load player names: ${error.message}` };
  const nameById = new Map((playerRows ?? []).map((p) => [p.sleeper_player_id, p.full_name as string]));

  const totalsById = new Map<string, number>(allIds.map((id) => [id, 0]));
  let weeksCounted = 0;
  const field = pointsFieldForLeague(scoringSettings);
  for (let week = move.week; week <= lastCompletedWeek; week++) {
    const weekPoints = await getWeekPoints(season, week, field);
    if (Object.keys(weekPoints).length === 0) continue;
    weeksCounted += 1;
    for (const id of allIds) {
      totalsById.set(id, (totalsById.get(id) ?? 0) + (weekPoints[id] ?? 0));
    }
  }

  const toOutcome = (id: string): MovePlayerOutcome => ({
    sleeperPlayerId: id,
    fullName: nameById.get(id) ?? "Unknown player",
    totalPoints: Math.round((totalsById.get(id) ?? 0) * 100) / 100,
  });

  const added = addedIds.map(toOutcome);
  const dropped = droppedIds.map(toOutcome);
  const netPoints =
    Math.round(
      (added.reduce((sum, p) => sum + p.totalPoints, 0) -
        dropped.reduce((sum, p) => sum + p.totalPoints, 0)) *
        100,
    ) / 100;

  return { ok: true, data: { weeksCounted, added, dropped, netPoints } };
}
