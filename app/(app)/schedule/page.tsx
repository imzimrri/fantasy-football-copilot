import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFantasyWeek } from "@/lib/sleeper";
import { ScheduleView, type ScheduleWeek } from "@/components/schedule-view";

async function ScheduleContent() {
  const supabase = await createClient();

  const { data: roster } = await supabase
    .from("rosters")
    .select("id")
    .eq("is_own_team", true)
    .maybeSingle();

  if (!roster) {
    return (
      <p className="text-sm text-foreground/60">
        No schedule synced yet — run the sync-league cron job to pull it from Sleeper.
      </p>
    );
  }

  const [matchupsResult, weekResult] = await Promise.all([
    supabase
      .from("matchups")
      .select("week, points, opponent_points, opponent_roster_id")
      .eq("roster_id", roster.id)
      .order("week"),
    getCurrentFantasyWeek(),
  ]);

  const opponentIds = [
    ...new Set((matchupsResult.data ?? []).map((m) => m.opponent_roster_id).filter(Boolean)),
  ] as string[];

  const { data: opponentRosters } =
    opponentIds.length > 0
      ? await supabase
          .from("rosters")
          .select("id, owner_display_name, wins, losses, points_for")
          .in("id", opponentIds)
      : { data: [] };

  const opponentById = new Map((opponentRosters ?? []).map((r) => [r.id, r]));

  const weeks: ScheduleWeek[] = (matchupsResult.data ?? []).map((m) => {
    const opponent = m.opponent_roster_id ? opponentById.get(m.opponent_roster_id) : undefined;
    return {
      week: m.week,
      opponentName: opponent?.owner_display_name ?? "TBD",
      opponentWins: opponent?.wins ?? 0,
      opponentLosses: opponent?.losses ?? 0,
      opponentPointsFor: opponent?.points_for ?? 0,
      ownPoints: m.points,
      opponentPoints: m.opponent_points,
    };
  });

  return (
    <ScheduleView weeks={weeks} currentWeek={weekResult.ok ? weekResult.data : null} />
  );
}

// `createClient()` reads cookies() — dynamic, must stream behind Suspense (Next.js 16
// Cache Components — see project_context.md).
export default function SchedulePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl">Schedule</h1>
        <p className="text-sm text-foreground/60">Your opponents for the rest of the season.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
        <ScheduleContent />
      </Suspense>
    </div>
  );
}
