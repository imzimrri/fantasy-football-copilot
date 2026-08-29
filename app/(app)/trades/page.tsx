import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { RecommendationCard } from "@/components/recommendation-card";
import { mapRecommendationRow } from "@/lib/types";

async function TradesContent() {
  const supabase = await createClient();

  const { data: league } = await supabase.from("leagues").select("id").maybeSingle();

  const { data: recommendationRows } = league
    ? await supabase
        .from("recommendations")
        .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
        .eq("league_id", league.id)
        .eq("category", "trade")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
    : { data: [] };

  const recommendations = (recommendationRows ?? []).map(mapRecommendationRow);

  if (recommendations.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        No pending trade offers right now. When someone proposes a trade in Sleeper
        involving your team, it&apos;ll show up here evaluated — run the
        trade-evaluation cron job (or trigger it manually while testing) to check for
        new ones.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {recommendations.map((rec) => (
        <RecommendationCard key={rec.id} recommendation={rec} />
      ))}
    </div>
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function TradesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl">Trades</h1>
        <p className="text-sm text-foreground/60">
          Real pending offers from Sleeper, evaluated for you.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <TradesContent />
      </Suspense>
    </div>
  );
}
