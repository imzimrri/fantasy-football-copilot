import * as sleeper from "@/lib/sleeper";
import { createServiceClient, getAppUserId } from "@/lib/supabase/service";
import type { Result } from "@/lib/sleeper";
import { findMatchingWaiverRecommendation } from "@/lib/waiver-moves";

export interface SyncSummary {
  leagueId: string;
  rosterCount: number;
  playerCount: number;
  matchupCount: number;
  tradeCount: number;
  moveCount: number;
  warnings: string[];
}

/**
 * Pulls league/roster/player/matchup data from Sleeper and upserts it into Supabase.
 * Best-effort: a failure syncing matchups (e.g., week 0 preseason) doesn't abort the
 * whole run — league/roster/player sync are the only hard-failure paths, per the
 * Integration Reliability NFR (degrade, don't crash the whole job).
 */
export async function syncLeague(): Promise<Result<SyncSummary>> {
  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  const username = process.env.SLEEPER_USERNAME;
  if (!leagueId || !username) {
    return {
      ok: false,
      error: "SLEEPER_LEAGUE_ID and SLEEPER_USERNAME must be set",
    };
  }

  const warnings: string[] = [];
  let userId: string;
  let db: ReturnType<typeof createServiceClient>;
  try {
    userId = getAppUserId();
    db = createServiceClient();
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  // 1. Resolve the Sleeper user_id for "which roster is mine" detection.
  const userResult = await sleeper.getUserByUsername(username);
  if (!userResult.ok) return userResult;
  const sleeperUserId = userResult.data.user_id;

  // 2. League metadata.
  const leagueResult = await sleeper.getLeague(leagueId);
  if (!leagueResult.ok) return leagueResult;
  const league = leagueResult.data;

  const { data: leagueRow, error: leagueError } = await db
    .from("leagues")
    .upsert(
      {
        user_id: userId,
        sleeper_league_id: league.league_id,
        name: league.name,
        season: league.season,
        scoring_settings: league.scoring_settings,
        roster_positions: league.roster_positions,
        settings: league.settings ?? {},
      },
      { onConflict: "user_id,sleeper_league_id" },
    )
    .select("id")
    .single();

  if (leagueError || !leagueRow) {
    return { ok: false, error: `Failed to upsert league: ${leagueError?.message}` };
  }
  const dbLeagueId = leagueRow.id as string;

  // 3. Rosters + which one is mine + owner display names (for the schedule view).
  const rostersResult = await sleeper.getRosters(leagueId);
  if (!rostersResult.ok) return rostersResult;

  const usersResult = await sleeper.getLeagueUsers(leagueId);
  if (!usersResult.ok) {
    warnings.push(`League users unavailable (opponent names will be blank): ${usersResult.error}`);
  }
  const displayNameByUserId = new Map(
    (usersResult.ok ? usersResult.data : []).map((u) => [u.user_id, u.display_name ?? u.user_id]),
  );

  const rosterIdByRosterId = new Map<number, string>();
  for (const roster of rostersResult.data) {
    const { data: rosterRow, error: rosterError } = await db
      .from("rosters")
      .upsert(
        {
          league_id: dbLeagueId,
          user_id: userId,
          sleeper_roster_id: roster.roster_id,
          sleeper_owner_id: roster.owner_id,
          owner_display_name: roster.owner_id
            ? (displayNameByUserId.get(roster.owner_id) ?? null)
            : null,
          is_own_team: roster.owner_id === sleeperUserId,
          wins: roster.settings?.wins ?? 0,
          losses: roster.settings?.losses ?? 0,
          ties: roster.settings?.ties ?? 0,
          points_for: roster.settings?.fpts ?? 0,
          points_against: roster.settings?.fpts_against ?? 0,
        },
        { onConflict: "league_id,sleeper_roster_id" },
      )
      .select("id")
      .single();

    if (rosterError || !rosterRow) {
      warnings.push(`Roster ${roster.roster_id}: ${rosterError?.message}`);
      continue;
    }
    rosterIdByRosterId.set(roster.roster_id, rosterRow.id as string);
  }

  // 4. Player cache — filter to fantasy-relevant positions to keep this manageable.
  let playerCount = 0;
  const allPlayersResult = await sleeper.getAllPlayers();
  if (!allPlayersResult.ok) {
    warnings.push(`Player sync skipped: ${allPlayersResult.error}`);
  } else {
    const relevant = Object.entries(allPlayersResult.data).filter(
      ([, p]) =>
        p.position &&
        (sleeper.FANTASY_POSITIONS as readonly string[]).includes(p.position),
    );
    const playerRows = relevant.map(([sleeperPlayerId, p]) => ({
      sleeper_player_id: sleeperPlayerId,
      full_name: p.full_name ?? "Unknown",
      position: p.position,
      team: p.team,
      status: p.injury_status ?? p.status ?? null,
    }));

    // Upsert in batches — thousands of rows in one call risks payload limits.
    const BATCH_SIZE = 500;
    for (let i = 0; i < playerRows.length; i += BATCH_SIZE) {
      const batch = playerRows.slice(i, i + BATCH_SIZE);
      const { error: playerError } = await db
        .from("players")
        .upsert(batch, { onConflict: "sleeper_player_id" });
      if (playerError) {
        warnings.push(`Player batch ${i}: ${playerError.message}`);
      } else {
        playerCount += batch.length;
      }
    }

    // 5. Roster <-> player assignments, now that both rosters and players exist.
    //
    // roster_slot assignment: Sleeper's `starters` array is positionally ordered to
    // match `roster_positions` with "BN" entries filtered out — e.g. roster_positions
    // ["QB","RB","RB",...,"K","BN","BN",...] means starters[0] is the QB slot,
    // starters[1] and [2] are the two RB slots, etc. This is how Sleeper's own UI
    // derives slot labels; there's no separate "slot" field on the roster object.
    const starterSlotTypes = (league.roster_positions ?? []).filter((p) => p !== "BN");

    for (const roster of rostersResult.data) {
      const dbRosterId = rosterIdByRosterId.get(roster.roster_id);
      if (!dbRosterId || !roster.players) continue;

      const starterIds = roster.starters ?? [];
      const slotByPlayerId = new Map<string, string>();
      starterIds.forEach((playerId, i) => {
        slotByPlayerId.set(playerId, starterSlotTypes[i] ?? "FLEX");
      });

      const rosterPlayerRows = roster.players.map((sleeperPlayerId) => ({
        roster_id: dbRosterId,
        user_id: userId,
        sleeper_player_id: sleeperPlayerId,
        is_starter: slotByPlayerId.has(sleeperPlayerId),
        roster_slot: slotByPlayerId.get(sleeperPlayerId) ?? "BN",
      }));

      const { error: rpError } = await db
        .from("roster_players")
        .upsert(rosterPlayerRows, { onConflict: "roster_id,sleeper_player_id" });
      if (rpError) {
        warnings.push(`Roster ${roster.roster_id} players: ${rpError.message}`);
      }

      // Prune stale entries — `upsert` only adds/updates, it never removes a player
      // who left the roster (dropped, traded away). Real bug found live: a user
      // dropped a player in Sleeper, re-ran sync, and the player still showed up here
      // — upsert alone can never fix that, since a departed player just doesn't
      // appear in `roster.players` anymore, it isn't represented as any row to
      // upsert. Diff-then-delete in app code (not a raw SQL NOT IN) to avoid
      // string-escaping a player-id list into a query.
      const currentPlayerIds = new Set(roster.players);
      const { data: existingRosterPlayers } = await db
        .from("roster_players")
        .select("sleeper_player_id")
        .eq("roster_id", dbRosterId);
      const staleIds = (existingRosterPlayers ?? [])
        .map((r) => r.sleeper_player_id as string)
        .filter((id) => !currentPlayerIds.has(id));
      if (staleIds.length > 0) {
        const { error: pruneError } = await db
          .from("roster_players")
          .delete()
          .eq("roster_id", dbRosterId)
          .in("sleeper_player_id", staleIds);
        if (pruneError) {
          warnings.push(`Roster ${roster.roster_id} prune: ${pruneError.message}`);
        }
      }
    }
  }

  // 6. Full-season schedule (not just the current week) — Sleeper generates every
  // regular-season week's roster pairings up front, even for weeks not yet played
  // (points are 0 until played), which is what makes a season-long "who am I playing"
  // view and game-plan agent possible. Regular season = weeks 1 through
  // (playoff_week_start - 1); best-effort per week, one bad week doesn't abort sync.
  let matchupCount = 0;
  const playoffWeekStart = Number(league.settings?.playoff_week_start ?? 15);
  const lastRegularSeasonWeek =
    Number.isFinite(playoffWeekStart) && playoffWeekStart > 1 ? playoffWeekStart - 1 : 14;

  for (let week = 1; week <= lastRegularSeasonWeek; week++) {
    const matchupsResult = await sleeper.getMatchups(leagueId, week);
    if (!matchupsResult.ok) {
      warnings.push(`Matchups for week ${week}: ${matchupsResult.error}`);
      continue;
    }

    const byMatchupId = new Map<number, typeof matchupsResult.data>();
    for (const m of matchupsResult.data) {
      if (m.matchup_id === null) continue;
      const group = byMatchupId.get(m.matchup_id) ?? [];
      group.push(m);
      byMatchupId.set(m.matchup_id, group);
    }

    for (const pair of byMatchupId.values()) {
      for (const m of pair) {
        const dbRosterId = rosterIdByRosterId.get(m.roster_id);
        if (!dbRosterId) continue;
        const opponent = pair.find((other) => other.roster_id !== m.roster_id);
        const dbOpponentRosterId = opponent
          ? rosterIdByRosterId.get(opponent.roster_id)
          : undefined;

        const { error: matchupError } = await db.from("matchups").upsert(
          {
            league_id: dbLeagueId,
            user_id: userId,
            week,
            roster_id: dbRosterId,
            opponent_roster_id: dbOpponentRosterId ?? null,
            points: m.points ?? null,
            opponent_points: opponent?.points ?? null,
          },
          { onConflict: "league_id,week,roster_id" },
        );
        if (matchupError) {
          warnings.push(`Matchup week ${week} roster ${m.roster_id}: ${matchupError.message}`);
        } else {
          matchupCount += 1;
        }
      }
    }
  }

  // 7. Trade offers (FR14-17) + waiver/free-agent moves (FR13d) — only transactions
  // involving the user's own roster. Looped across the same week range as matchups,
  // one `getTransactions` call per week shared by both; most future weeks return no
  // transactions yet, which is fine, these are cheap unauthenticated requests.
  let tradeCount = 0;
  let moveCount = 0;
  const ownSleeperRosterId = rostersResult.data.find(
    (r) => r.owner_id === sleeperUserId,
  )?.roster_id;
  const playerNameById = new Map<string, string>(
    allPlayersResult.ok
      ? Object.entries(allPlayersResult.data).map(([id, p]) => [id, p.full_name ?? "Unknown"])
      : [],
  );

  if (ownSleeperRosterId !== undefined) {
    for (let week = 1; week <= lastRegularSeasonWeek; week++) {
      const transactionsResult = await sleeper.getTransactions(leagueId, week);
      if (!transactionsResult.ok) {
        warnings.push(`Transactions for week ${week}: ${transactionsResult.error}`);
        continue;
      }

      const ownTransactions = transactionsResult.data.filter((t) =>
        t.roster_ids.includes(ownSleeperRosterId),
      );

      for (const trade of ownTransactions.filter((t) => t.type === "trade")) {
        const { error: tradeError } = await db.from("trades").upsert(
          {
            user_id: userId,
            league_id: dbLeagueId,
            sleeper_transaction_id: trade.transaction_id,
            status: trade.status,
            week,
            roster_ids_involved: trade.roster_ids,
            adds: trade.adds ?? {},
            drops: trade.drops ?? {},
            draft_picks: trade.draft_picks,
          },
          { onConflict: "sleeper_transaction_id" },
        );
        if (tradeError) {
          warnings.push(`Trade ${trade.transaction_id}: ${tradeError.message}`);
        } else {
          tradeCount += 1;
        }
      }

      const moves = ownTransactions.filter(
        (t) => (t.type === "waiver" || t.type === "free_agent") && t.status === "complete",
      );

      for (const move of moves) {
        const addedNames = Object.keys(move.adds ?? {}).map(
          (id) => playerNameById.get(id) ?? id,
        );
        const droppedNames = Object.keys(move.drops ?? {}).map(
          (id) => playerNameById.get(id) ?? id,
        );

        const matchedRecommendationId = await findMatchingWaiverRecommendation(db, {
          userId,
          leagueId: dbLeagueId,
          week,
          addedNames,
          droppedNames,
          beforeIso: new Date().toISOString(),
        });

        const { error: moveError } = await db.from("roster_moves").upsert(
          {
            user_id: userId,
            league_id: dbLeagueId,
            sleeper_transaction_id: move.transaction_id,
            type: move.type,
            status: move.status,
            week,
            adds: move.adds ?? {},
            drops: move.drops ?? {},
            matched_recommendation_id: matchedRecommendationId,
          },
          { onConflict: "sleeper_transaction_id" },
        );
        if (moveError) {
          warnings.push(`Roster move ${move.transaction_id}: ${moveError.message}`);
          continue;
        }
        moveCount += 1;

        // Auto-mark the matched recommendation "followed" — best-effort, only if it's
        // still pending (never overwrite a status the user already set themselves).
        if (matchedRecommendationId) {
          await db
            .from("recommendations")
            .update({ status: "followed" })
            .eq("id", matchedRecommendationId)
            .eq("status", "pending");
        }
      }
    }
  }

  return {
    ok: true,
    data: {
      leagueId: dbLeagueId,
      rosterCount: rosterIdByRosterId.size,
      playerCount,
      matchupCount,
      tradeCount,
      moveCount,
      warnings,
    },
  };
}
