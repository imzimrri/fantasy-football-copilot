import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadRosterPlayers } from "@/lib/agents/shared";
import { LineupView } from "@/components/lineup-view";
import { RefreshButton } from "@/components/refresh-button";
import { mapRecommendationRow } from "@/lib/types";

async function RosterContent() {
  const supabase = await createClient();

  const { data: roster } = await supabase
    .from("rosters")
    .select("id, league_id")
    .eq("is_own_team", true)
    .maybeSingle();

  if (!roster) {
    return (
      <p className="text-sm text-foreground/60">
        No roster data yet — run the sync-league cron job (or trigger it manually
        while testing) to pull your roster from Sleeper.
      </p>
    );
  }

  const [playersResult, leagueResult, recommendationsResult, notesResult] = await Promise.all([
    loadRosterPlayers(supabase, roster.id),
    supabase.from("leagues").select("roster_positions").eq("id", roster.league_id).single(),
    supabase
      .from("recommendations")
      .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
      .eq("league_id", roster.league_id)
      .eq("category", "start_sit")
      .eq("status", "pending"),
    supabase.from("player_notes").select("sleeper_player_id, note"),
  ]);

  if (!playersResult.ok) {
    return <p className="text-sm text-destructive">{playersResult.error}</p>;
  }

  const recommendations = (recommendationsResult.data ?? []).map(mapRecommendationRow);
  const notes = new Map(
    (notesResult.data ?? []).map((n) => [n.sleeper_player_id as string, n.note as string]),
  );

  return (
    <LineupView
      players={playersResult.data}
      recommendations={recommendations}
      rosterPositions={(leagueResult.data?.roster_positions as string[] | null) ?? null}
      notes={notes}
    />
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function RosterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-bold text-2xl">Your Roster</h1>
        <RefreshButton />
      </div>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <RosterContent />
      </Suspense>
    </div>
  );
}
