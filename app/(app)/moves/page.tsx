import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getLastCompletedWeek } from "@/lib/sleeper";
import { computeMoveOutcome, type MoveOutcome } from "@/lib/waiver-moves";
import { MoveCard } from "@/components/move-card";
import { mapRecommendationRow, mapRosterMoveRow, type Recommendation } from "@/lib/types";

async function MovesContent() {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, season, scoring_settings")
    .maybeSingle();

  if (!league) {
    return (
      <p className="text-sm text-foreground/60">
        No league synced yet. Run the sync-league cron job (or trigger it manually
        while testing) to pull your Sleeper league in.
      </p>
    );
  }

  const [{ data: moveRows }, lastCompletedWeekResult] = await Promise.all([
    supabase
      .from("roster_moves")
      .select("id, league_id, type, status, week, adds, drops, matched_recommendation_id, created_at")
      .eq("league_id", league.id)
      .order("week", { ascending: false })
      .order("created_at", { ascending: false }),
    getLastCompletedWeek(),
  ]);

  const moves = (moveRows ?? []).map(mapRosterMoveRow);

  if (moves.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        No waiver or free-agent moves synced yet. Once you add/drop a player in
        Sleeper, it&apos;ll show up here after the next sync — along with a real point
        comparison once games have been played.
      </p>
    );
  }

  const recommendationIds = [
    ...new Set(moves.map((m) => m.matchedRecommendationId).filter((id): id is string => !!id)),
  ];
  const recommendationById = new Map<string, Recommendation>();
  if (recommendationIds.length > 0) {
    const { data: recRows } = await supabase
      .from("recommendations")
      .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
      .in("id", recommendationIds);
    for (const row of recRows ?? []) {
      recommendationById.set(row.id, mapRecommendationRow(row));
    }
  }

  const lastCompletedWeek = lastCompletedWeekResult.ok ? lastCompletedWeekResult.data : 0;
  const scoringSettings = (league.scoring_settings as Record<string, number> | null) ?? null;
  const season = league.season ?? new Date().getFullYear().toString();

  const outcomes = await Promise.all(
    moves.map((move) =>
      computeMoveOutcome(supabase, move, season, lastCompletedWeek, scoringSettings),
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      {moves.map((move, i) => {
        const outcomeResult = outcomes[i];
        const outcome: MoveOutcome | null = outcomeResult.ok ? outcomeResult.data : null;
        return (
          <MoveCard
            key={move.id}
            move={move}
            outcome={outcome}
            matchedRecommendation={
              move.matchedRecommendationId
                ? (recommendationById.get(move.matchedRecommendationId) ?? null)
                : null
            }
          />
        );
      })}
    </div>
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function MovesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl">Moves</h1>
        <p className="text-sm text-foreground/60">
          Every real waiver/free-agent add and drop, synced from Sleeper — was it worth
          it? Once games are played, each move shows a real point comparison between
          who you added and who you dropped.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <MovesContent />
      </Suspense>
    </div>
  );
}
