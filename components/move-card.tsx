"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MoveOutcome } from "@/lib/waiver-moves";
import type { Recommendation, RosterMove } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  waiver: "Waiver",
  free_agent: "Free Agent",
};

/**
 * One real Sleeper add/drop, with — once enough weeks have been played — a real,
 * Sleeper-scored point comparison between who was added and who was dropped. This is
 * the retrospective the user asked for: "would the waiver suggestion have given me an
 * advantage, or was it worth dropping that player." Never shows a fabricated verdict —
 * `weeksCounted === 0` renders as "too early to tell," not a false 0-0 tie.
 */
export function MoveCard({
  move,
  outcome,
  matchedRecommendation,
}: {
  move: RosterMove;
  outcome: MoveOutcome | null;
  matchedRecommendation: Recommendation | null;
}) {
  const [open, setOpen] = useState(false);

  const addedNames = outcome?.added.map((p) => p.fullName) ?? Object.keys(move.adds);
  const droppedNames = outcome?.dropped.map((p) => p.fullName) ?? Object.keys(move.drops);
  const hasOutcome = !!outcome && outcome.weeksCounted > 0;

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
      >
        {hasOutcome ? (
          outcome!.netPoints >= 0 ? (
            <TrendingUp size={18} className="shrink-0 mt-0.5 text-green-600 dark:text-green-500" />
          ) : (
            <TrendingDown size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-500" />
          )
        ) : (
          <ArrowRight size={18} className="shrink-0 mt-0.5 text-foreground/40" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-foreground/40 flex items-center gap-1.5">
            {TYPE_LABEL[move.type] ?? move.type} · Week {move.week}
            {matchedRecommendation && (
              <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 normal-case tracking-normal">
                <Sparkles size={11} /> followed a suggestion
              </span>
            )}
          </p>
          <p className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
            {addedNames.length > 0 && (
              <span className="text-green-600 dark:text-green-500">
                Add {addedNames.join(", ")}
              </span>
            )}
            {addedNames.length > 0 && droppedNames.length > 0 && (
              <ArrowRight size={14} className="text-foreground/40" />
            )}
            {droppedNames.length > 0 && (
              <span className="text-red-600 dark:text-red-500">
                Drop {droppedNames.join(", ")}
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {hasOutcome ? (
            <p
              className={cn(
                "text-sm font-bold",
                outcome!.netPoints >= 0
                  ? "text-green-600 dark:text-green-500"
                  : "text-red-600 dark:text-red-500",
              )}
            >
              {outcome!.netPoints >= 0 ? "+" : ""}
              {outcome!.netPoints} pts
            </p>
          ) : (
            <p className="text-xs text-foreground/40">Too early to tell</p>
          )}
        </div>
        <ChevronDown
          size={16}
          className={cn(
            "text-foreground/40 transition-transform shrink-0 mt-1",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pl-[2.75rem] flex flex-col gap-2.5 animate-in fade-in duration-150">
          {outcome && outcome.weeksCounted > 0 ? (
            <div className="flex flex-col gap-1 text-sm bg-muted/50 rounded-md p-2.5">
              <p className="text-foreground/60 text-xs mb-1">
                Real Sleeper-scored points, {outcome.weeksCounted} week
                {outcome.weeksCounted === 1 ? "" : "s"} since the move (approximate — based on
                standard scoring for this league&apos;s format, doesn&apos;t account for every
                custom bonus).
              </p>
              {outcome.added.map((p) => (
                <p key={p.sleeperPlayerId} className="flex justify-between">
                  <span className="text-green-600 dark:text-green-500">+ {p.fullName}</span>
                  <span className="text-foreground/80">{p.totalPoints} pts</span>
                </p>
              ))}
              {outcome.dropped.map((p) => (
                <p key={p.sleeperPlayerId} className="flex justify-between">
                  <span className="text-red-600 dark:text-red-500">− {p.fullName}</span>
                  <span className="text-foreground/80">{p.totalPoints} pts</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-foreground/60">
              No completed weeks yet since this move — the point comparison will show up here
              once games have been played.
            </p>
          )}
          {matchedRecommendation ? (
            <div className="flex gap-2 text-sm bg-blue-500/10 rounded-md p-2.5">
              <Sparkles size={16} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-foreground/80">
                <span className="font-medium">The AI&apos;s original reasoning: </span>
                {matchedRecommendation.reasoning}
              </p>
            </div>
          ) : (
            <p className="text-xs text-foreground/40">
              Made on your own — not from an AI waiver suggestion.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
