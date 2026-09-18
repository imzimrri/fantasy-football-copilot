"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Handshake,
  Lightbulb,
  ListChecks,
  Newspaper,
  Search,
  Swords,
} from "lucide-react";
import { SourcesList } from "@/components/sources-list";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/types";

const CATEGORY_META: Record<
  Recommendation["category"],
  { label: string; icon: typeof ListChecks; accent: string }
> = {
  start_sit: { label: "Start/Sit", icon: ListChecks, accent: "text-sky-500" },
  waiver: { label: "Waiver", icon: Search, accent: "text-emerald-500" },
  trade: { label: "Trade", icon: Handshake, accent: "text-amber-500" },
  news: { label: "News", icon: Newspaper, accent: "text-zinc-500" },
  matchup: { label: "Matchup", icon: Swords, accent: "text-red-500" },
};

/**
 * The action a recommendation implies, read defensively from its payload — surfaced
 * as a clear "do this" line instead of leaving it buried in reasoning prose. Payload
 * shape varies by category (see lib/agents/*.ts for what each one writes).
 */
function ActionSummary({ recommendation }: { recommendation: Recommendation }) {
  const { category, payload } = recommendation;

  if (category === "waiver") {
    const addPlayer = payload.addPlayer as string | undefined;
    const dropCandidate = payload.dropCandidate as string | undefined;
    const usageStats = payload.usageStats as string | undefined;
    if (!addPlayer) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
          <span className="text-green-600 dark:text-green-500">Add {addPlayer}</span>
          {dropCandidate && (
            <>
              <ArrowRight size={14} className="text-foreground/40" />
              <span className="text-red-600 dark:text-red-500">Drop {dropCandidate}</span>
            </>
          )}
        </p>
        {usageStats && <p className="text-xs text-foreground/60">{usageStats}</p>}
      </div>
    );
  }

  if (category === "start_sit") {
    const player = payload.player as string | undefined;
    const action = payload.action as string | undefined;
    if (!player || !action) return null;
    const comparedTo = payload.comparedTo as string | undefined;
    const projection = payload.projection as string | undefined;
    const actionLabel: Record<string, string> = {
      start: "Start",
      sit: "Sit",
      flag_injury: "⚠ Injury flag",
      note: "Note",
    };
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          {actionLabel[action] ?? action}: {player}
          {comparedTo && <span className="text-foreground/50"> over {comparedTo}</span>}
        </p>
        {projection && <p className="text-xs text-foreground/60">{projection}</p>}
      </div>
    );
  }

  if (category === "trade" && payload.type === "suggestion") {
    const proposedGive = payload.proposedGive as string | undefined;
    const proposedReceive = payload.proposedReceive as string | undefined;
    const targetTeamName = payload.targetTeamName as string | undefined;
    if (!proposedGive || !proposedReceive) return null;
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
          Idea: propose to {targetTeamName ?? "another team"}
        </p>
        <p className="text-sm flex items-center gap-1.5 flex-wrap text-foreground/80">
          <span>Offer: {proposedGive}</span>
          <ArrowRight size={14} className="text-foreground/40" />
          <span>For: {proposedReceive}</span>
        </p>
      </div>
    );
  }

  if (category === "trade") {
    const action = payload.action as string | undefined;
    const receive = payload.receive as string | undefined;
    const give = payload.give as string | undefined;
    if (!action) return null;
    const actionMeta: Record<string, { label: string; className: string }> = {
      accept: { label: "Accept", className: "text-green-600 dark:text-green-500" },
      decline: { label: "Decline", className: "text-red-600 dark:text-red-500" },
      counter: { label: "Counter", className: "text-amber-600 dark:text-amber-500" },
    };
    const meta = actionMeta[action] ?? { label: action, className: "" };
    return (
      <div className="flex flex-col gap-1">
        <p className={cn("text-sm font-bold", meta.className)}>{meta.label}</p>
        {receive && give && (
          <p className="text-sm flex items-center gap-1.5 flex-wrap text-foreground/80">
            <span>Receive: {receive}</span>
            <ArrowRight size={14} className="text-foreground/40" />
            <span>Give: {give}</span>
          </p>
        )}
      </div>
    );
  }

  return null;
}

/**
 * A waiver drop or trade is a season-long decision. Shown as a distinct block from
 * the immediate "why now" reasoning, not buried inside it.
 */
function SeasonOutlook({ recommendation }: { recommendation: Recommendation }) {
  if (recommendation.category !== "waiver" && recommendation.category !== "trade") return null;
  const outlook = recommendation.payload.restOfSeasonOutlook as string | undefined;
  if (!outlook) return null;
  return (
    <div className="flex gap-2 text-sm bg-muted/50 rounded-md p-2.5">
      <CalendarClock size={16} className="text-foreground/50 shrink-0 mt-0.5" />
      <p className="text-foreground/80">
        <span className="font-medium">Rest of season: </span>
        {outlook}
      </p>
    </div>
  );
}

function CounterSuggestion({ recommendation }: { recommendation: Recommendation }) {
  if (recommendation.category !== "trade") return null;
  const suggestion = recommendation.payload.counterSuggestion as string | undefined;
  if (!suggestion) return null;
  return (
    <div className="flex gap-2 text-sm bg-amber-500/10 rounded-md p-2.5">
      <p className="text-foreground/80">
        <span className="font-medium">Counter idea: </span>
        {suggestion}
      </p>
    </div>
  );
}

/** Why the OTHER team would plausibly accept — a proactive trade idea needs to make
 *  the case for both sides, not just why it helps me. */
function MutualBenefit({ recommendation }: { recommendation: Recommendation }) {
  if (recommendation.category !== "trade" || recommendation.payload.type !== "suggestion") {
    return null;
  }
  const reasoning = recommendation.payload.mutualBenefitReasoning as string | undefined;
  if (!reasoning) return null;
  return (
    <div className="flex gap-2 text-sm bg-blue-500/10 rounded-md p-2.5">
      <p className="text-foreground/80">
        <span className="font-medium">Why they&apos;d say yes: </span>
        {reasoning}
      </p>
    </div>
  );
}

/**
 * Renders one agent recommendation with its required reasoning (FR6/FR12/FR16) and
 * sources (FR6a/FR12a). Whole-block click to expand — same interaction pattern as the
 * Schedule page's week rows, so the app doesn't feel like three different apps stapled
 * together. `actions`, when passed (History's follow/dismiss buttons), renders inside
 * the expanded body.
 */
export function RecommendationCard({
  recommendation,
  defaultOpen = false,
  actions,
}: {
  recommendation: Recommendation;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isSuggestion = recommendation.category === "trade" && recommendation.payload.type === "suggestion";
  const meta = CATEGORY_META[recommendation.category];
  const Icon = isSuggestion ? Lightbulb : meta.icon;
  const label = isSuggestion ? "Trade Idea" : meta.label;
  const accent = isSuggestion ? "text-blue-500" : meta.accent;

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
      >
        <Icon size={18} className={cn("shrink-0 mt-0.5", accent)} />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-foreground/40">
            {label}
            {recommendation.week && ` · Week ${recommendation.week}`}
          </p>
          <p className="font-medium text-sm truncate">{recommendation.title}</p>
          <div className="mt-1">
            <ActionSummary recommendation={recommendation} />
          </div>
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
          <p className="text-sm text-foreground/80">{recommendation.reasoning}</p>
          <SeasonOutlook recommendation={recommendation} />
          <CounterSuggestion recommendation={recommendation} />
          <MutualBenefit recommendation={recommendation} />
          <SourcesList sources={recommendation.sources} />
          {actions}
        </div>
      )}
    </div>
  );
}
