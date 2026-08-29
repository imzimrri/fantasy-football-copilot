import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { WaiverList } from "@/components/waiver-list";
import { WatchlistPanel } from "@/components/watchlist-panel";
import { mapRecommendationRow } from "@/lib/types";

async function WaiversContent() {
  const supabase = await createClient();

  const { data: league } = await supabase.from("leagues").select("id").maybeSingle();

  const [{ data: recommendationRows }, { data: watchlistRows }] = await Promise.all([
    league
      ? supabase
          .from("recommendations")
          .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
          .eq("league_id", league.id)
          .eq("category", "waiver")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("watchlist_players")
      .select("sleeper_player_id, note, players(full_name, position, team)"),
  ]);

  const recommendations = (recommendationRows ?? []).map(mapRecommendationRow);
  const watchlist = (watchlistRows ?? []).map((row) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;
    return {
      sleeperPlayerId: row.sleeper_player_id as string,
      fullName: (player?.full_name as string | undefined) ?? "Unknown",
      position: (player?.position as string | undefined) ?? null,
      team: (player?.team as string | undefined) ?? null,
      note: row.note as string | null,
    };
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <WaiverList recommendations={recommendations} />
      <WatchlistPanel initialWatchlist={watchlist} />
    </div>
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function WaiversPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-bold text-2xl">Waiver Wire</h1>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <WaiversContent />
      </Suspense>
    </div>
  );
}
