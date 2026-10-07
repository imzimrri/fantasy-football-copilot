import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFantasyWeek, pickDisplayWeek } from "@/lib/sleeper";
import { loadRosterPlayers } from "@/lib/agents/shared";
import { MatchupCard } from "@/components/matchup-card";
import { LineupView } from "@/components/lineup-view";
import { RefreshButton } from "@/components/refresh-button";
import { RunAnalysisButton, type LastRun } from "@/components/run-analysis-button";
import { mapRecommendationRow } from "@/lib/types";

async function DashboardContent() {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .maybeSingle();

  if (!league) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-bold text-2xl">Welcome to Fantasy Football Copilot</h1>
        <p className="text-sm text-foreground/70">
          No league synced yet. Run the sync-league cron job (or trigger it manually
          while testing) to pull your Sleeper league in.
        </p>
      </div>
    );
  }

  const { data: roster } = await supabase
    .from("rosters")
    .select("id, league_id")
    .eq("is_own_team", true)
    .maybeSingle();

  // Week must be known BEFORE the recommendations query — matchup/start_sit
  // recommendations are week-scoped, and without filtering to the current week here,
  // a prior week's "matchup" (or start_sit) row that's still `status: pending` (never
  // superseded within its own week+category, never dismissed by the user) would keep
  // showing on the dashboard as if it were this week's, e.g. still displaying last
  // week's opponent after the week rolled over.
  const weekResult = await getCurrentFantasyWeek();
  const week = weekResult.ok ? weekResult.data : null;

  // If this week has no lineup analysis yet (week just rolled over, or today's run
  // failed), show the most recent week that does — labeled — rather than an empty page.
  const { data: weekRows } = await supabase
    .from("recommendations")
    .select("week")
    .eq("league_id", league.id)
    .eq("status", "pending")
    .in("category", ["start_sit", "matchup"]);
  const display = pickDisplayWeek(
    week,
    [...new Set((weekRows ?? []).map((r) => r.week as number | null))].filter(
      (w): w is number => w !== null,
    ),
  );

  let recommendationsQuery = supabase
    .from("recommendations")
    .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
    .eq("league_id", league.id)
    .eq("status", "pending");
  if (display.week !== null) {
    recommendationsQuery = recommendationsQuery.eq("week", display.week);
  }

  const [
    recommendationsResult,
    playersResult,
    leagueSettingsResult,
    notesResult,
    matchupResult,
    lastRunResult,
  ] = await Promise.all([
    recommendationsQuery.order("created_at", { ascending: false }),
    roster ? loadRosterPlayers(supabase, roster.id) : Promise.resolve(null),
    supabase.from("leagues").select("roster_positions").eq("id", league.id).single(),
    supabase.from("player_notes").select("sleeper_player_id, note"),
    // Opponent comes straight from the synced schedule, not from the roster-analysis
    // output — so the matchup card still says who you're playing even when that
    // agent hasn't run (or failed) for this week.
    roster && week !== null
      ? supabase
          .from("matchups")
          .select("opponent:rosters!matchups_opponent_roster_id_fkey(owner_display_name)")
          .eq("roster_id", roster.id)
          .eq("week", week)
          .maybeSingle()
      : Promise.resolve(null),
    supabase
      .from("agent_runs")
      .select("status, error, finished_at")
      .eq("agent", "roster-analysis")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const recommendations = (recommendationsResult.data ?? []).map(mapRecommendationRow);
  const notes = new Map(
    (notesResult.data ?? []).map((n) => [n.sleeper_player_id as string, n.note as string]),
  );
  // A fallback week's matchup outlook is about LAST week's opponent — never show it
  // under this week's header.
  const matchupOutlook = display.isFallback
    ? null
    : (recommendations.find((r) => r.category === "matchup") ?? null);
  const opponentRow = matchupResult?.data?.opponent as
    | { owner_display_name: string | null }
    | { owner_display_name: string | null }[]
    | null
    | undefined;
  const scheduledOpponent = Array.isArray(opponentRow)
    ? (opponentRow[0]?.owner_display_name ?? null)
    : (opponentRow?.owner_display_name ?? null);
  const opponentName =
    scheduledOpponent ?? (matchupOutlook?.payload.opponentName as string | null) ?? null;
  const lineupRecommendations = recommendations.filter((r) => r.category === "start_sit");
  const lastRun: LastRun | null = lastRunResult.data
    ? {
        status: lastRunResult.data.status as "ok" | "error",
        error: (lastRunResult.data.error as string | null) ?? null,
        finishedAt: lastRunResult.data.finished_at as string,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-bold text-2xl">{league.name}</h1>
          {week && <p className="text-sm text-foreground/60">Week {week}</p>}
        </div>
        <RefreshButton />
      </div>
      <RunAnalysisButton lastRun={lastRun} />
      <MatchupCard opponentName={opponentName} outlook={matchupOutlook} />
      <div>
        <h2 className="font-medium text-sm text-foreground/60 uppercase tracking-wide mb-1">
          This Week&apos;s Lineup
        </h2>
        {display.isFallback && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
            Showing Week {display.week} analysis — Week {week} hasn&apos;t been analyzed
            yet. Run analysis now to refresh.
          </p>
        )}
        <LineupView
          players={playersResult?.ok ? playersResult.data : []}
          recommendations={lineupRecommendations}
          rosterPositions={
            (leagueSettingsResult.data?.roster_positions as string[] | null) ?? null
          }
          notes={notes}
        />
      </div>
    </div>
  );
}

// `createClient()` reads cookies() — genuinely per-user dynamic data, so this must
// stream in behind Suspense rather than be prerendered/cached (Cache Components,
// Next.js 16 — see project_context.md).
export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
      <DashboardContent />
    </Suspense>
  );
}
