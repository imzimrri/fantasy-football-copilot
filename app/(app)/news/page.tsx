import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { RecommendationCard } from "@/components/recommendation-card";
import { mapRecommendationRow } from "@/lib/types";

async function NewsContent() {
  const supabase = await createClient();

  const { data: league } = await supabase.from("leagues").select("id").maybeSingle();

  const { data: recommendationRows } = league
    ? await supabase
        .from("recommendations")
        .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
        .eq("league_id", league.id)
        .eq("category", "news")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
    : { data: [] };

  const recommendations = (recommendationRows ?? []).map(mapRecommendationRow);

  if (recommendations.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        Nothing newsworthy right now — that&apos;s a normal outcome, not a broken
        feature. Run the news-monitoring cron job (or trigger it manually while
        testing) to check again.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {recommendations.map((rec) => (
        <RecommendationCard key={rec.id} recommendation={rec} />
      ))}
    </div>
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function NewsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl">News</h1>
        <p className="text-sm text-foreground/60">
          Recent news relevant to your roster.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <NewsContent />
      </Suspense>
    </div>
  );
}
