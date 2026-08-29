"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerNoteEditor } from "@/components/player-note-editor";
import { SourcesList } from "@/components/sources-list";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentPlayer } from "@/lib/agents/shared";
import type { Recommendation } from "@/lib/types";

const SLOT_COLOR: Record<string, string> = {
  QB: "bg-red-500",
  RB: "bg-emerald-500",
  WR: "bg-sky-500",
  TE: "bg-orange-500",
  K: "bg-purple-500",
  FLEX: "bg-zinc-500",
  SUPER_FLEX: "bg-zinc-500",
  BN: "bg-zinc-400",
};

const ACTION_LABEL: Record<string, string> = {
  start: "Start",
  sit: "Sit",
  flag_injury: "⚠ Injury flag",
  note: "Note",
};

function SlotBadge({ slot }: { slot: string | null }) {
  const label = slot === "SUPER_FLEX" ? "SFLX" : (slot ?? "BN");
  return (
    <div
      className={cn(
        "size-10 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0",
        SLOT_COLOR[slot ?? "BN"] ?? "bg-zinc-500",
      )}
    >
      {label}
    </div>
  );
}

/**
 * One lineup row: slot badge, player, our recommendation for that player this week (or
 * an explicit "Leave as is"), and always — even with no active recommendation — a
 * place to record your own reasoning for holding them. Every row is expandable (not
 * just ones with a recommendation), specifically so you can add a note to a bench
 * player nothing is currently flagged about, e.g. a handcuff you're stashing on
 * purpose. Whole-row click to expand, matching the interaction pattern used everywhere
 * else in the app.
 */
export function LineupRow({
  player,
  recommendation,
  note,
}: {
  player: AgentPlayer;
  recommendation: Recommendation | null;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const action = recommendation?.payload.action as string | undefined;

  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 py-3 hover:bg-muted/40 transition-colors rounded-md text-left"
      >
        <SlotBadge slot={player.rosterSlot} />
        <PlayerAvatar sleeperPlayerId={player.sleeperPlayerId} fullName={player.fullName} />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{player.fullName}</p>
          <div className="text-xs text-foreground/60 flex items-center gap-1.5">
            {player.position} · {player.team ?? "FA"}
            {player.status && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {player.status}
              </Badge>
            )}
          </div>
        </div>
        {recommendation ? (
          <p className="text-sm font-medium text-right shrink-0 max-w-[40%]">
            {action ? (ACTION_LABEL[action] ?? action) : recommendation.title}
          </p>
        ) : (
          <p className="text-sm text-foreground/50 flex items-center gap-1.5 shrink-0">
            <Check size={14} className="text-emerald-500" />
            Leave as is
          </p>
        )}
        <ChevronDown
          size={16}
          className={cn(
            "text-foreground/40 transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="pb-3 pl-[3.25rem] flex flex-col gap-2 animate-in fade-in duration-150">
          {recommendation && (
            <>
              <p className="text-sm text-foreground/80">{recommendation.reasoning}</p>
              <SourcesList sources={recommendation.sources} />
            </>
          )}
          <PlayerNoteEditor sleeperPlayerId={player.sleeperPlayerId} initialNote={note} />
        </div>
      )}
    </div>
  );
}
