import { Frown, Meh, Smile } from "lucide-react";
import { ReasoningDisclosure } from "@/components/reasoning-disclosure";
import { SourcesList } from "@/components/sources-list";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/types";

const CONFIDENCE: Record<
  string,
  { label: string; icon: typeof Smile; className: string }
> = {
  favorable: {
    label: "Favorable matchup",
    icon: Smile,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  toss_up: {
    label: "Toss-up",
    icon: Meh,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  tough: {
    label: "Tough matchup",
    icon: Frown,
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
};

/**
 * "Who am I playing, and what's my shot this week" — the top-of-dashboard answer.
 * Deliberately a qualitative read (favorable/toss-up/tough), never a fabricated
 * numeric win %, since there's no real projection data to back a number — see
 * lib/agents/roster-analysis.ts.
 */
export function MatchupCard({
  opponentName,
  outlook,
}: {
  opponentName: string | null;
  outlook: Recommendation | null;
}) {
  if (!opponentName) {
    return (
      <div className="rounded-xl border p-4">
        <p className="text-sm text-foreground/60">
          No matchup data yet for this week — run the sync-league cron job to pull it in.
        </p>
      </div>
    );
  }

  const confidence = outlook?.payload.confidence as string | undefined;
  const meta = confidence ? CONFIDENCE[confidence] : null;
  const Icon = meta?.icon;

  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/50">This week</p>
          <h2 className="text-lg font-semibold">vs {opponentName}</h2>
        </div>
        {meta && Icon && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
              meta.className,
            )}
          >
            <Icon size={16} />
            {meta.label}
          </span>
        )}
      </div>
      {outlook ? (
        <div>
          <ReasoningDisclosure reasoning={outlook.reasoning} />
          <SourcesList sources={outlook.sources} />
        </div>
      ) : (
        <p className="text-sm text-foreground/50">
          No outlook yet — run the roster-analysis cron job to generate one.
        </p>
      )}
    </div>
  );
}
