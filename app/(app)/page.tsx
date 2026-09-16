import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFantasyWeek } from "@/lib/sleeper";
import { loadRosterPlayers } from "@/lib/agents/shared";
import { MatchupCard } from "@/components/matchup-card";
import { LineupView } from "@/components/lineup-view";
import { RefreshButton } from "@/components/refresh-button";
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

  let recommendationsQuery = supabase
    .from("recommendations")
    .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
    .eq("league_id", league.id)
    .eq("status", "pending");
  if (week !== null) {
    recommendationsQuery = recommendationsQuery.eq("week", week);
  }

  const [recommendationsResult, playersResult, leagueSettingsResult, notesResult] =
    await Promise.all([
      recommendationsQuery.order("created_at", { ascending: false }),
      roster ? loadRosterPlayers(supabase, roster.id) : Promise.resolve(null),
      supabase.from("leagues").select("roster_positions").eq("id", league.id).single(),
      supabase.from("player_notes").select("sleeper_player_id, note"),
    ]);

  const recommendations = (recommendationsResult.data ?? []).map(mapRecommendationRow);
  const notes = new Map(
    (notesResult.data ?? []).map((n) => [n.sleeper_player_id as string, n.note as string]),
  );
  const matchupOutlook = recommendations.find((r) => r.category === "matchup") ?? null;
  const opponentName = (matchupOutlook?.payload.opponentName as string | null) ?? null;
  const lineupRecommendations = recommendations.filter((r) => r.category === "start_sit");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-bold text-2xl">{league.name}</h1>
          {week && <p className="text-sm text-foreground/60">Week {week}</p>}
        </div>
        <RefreshButton />
      </div>
      <MatchupCard opponentName={opponentName} outlook={matchupOutlook} />
      <div>
        <h2 className="font-medium text-sm text-foreground/60 uppercase tracking-wide mb-1">
          This Week&apos;s Lineup
        </h2>
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
