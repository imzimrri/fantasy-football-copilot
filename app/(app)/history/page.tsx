import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { RecommendationCard } from "@/components/recommendation-card";
import { HistoryActions } from "@/components/history-actions";
import { mapRecommendationRow } from "@/lib/types";

async function HistoryContent() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("recommendations")
    .select("id, league_id, category, week, title, reasoning, sources, payload, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const recommendations = (rows ?? []).map(mapRecommendationRow);

  if (recommendations.length === 0) {
    return <p className="text-sm text-foreground/60">No recommendations yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {recommendations.map((rec) => (
        <RecommendationCard
          key={rec.id}
          recommendation={rec}
          actions={<HistoryActions id={rec.id} status={rec.status} />}
        />
      ))}
    </div>
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-bold text-2xl">History</h1>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <HistoryContent />
      </Suspense>
    </div>
  );
}
