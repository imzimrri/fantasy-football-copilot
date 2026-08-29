"use client";

import { useState } from "react";
import { ChevronDown, Flame, Shield, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScheduleWeek {
  week: number;
  opponentName: string;
  opponentWins: number;
  opponentLosses: number;
  opponentPointsFor: number;
  ownPoints: number | null;
  opponentPoints: number | null;
}

function difficultyBadge(opponent: ScheduleWeek) {
  const games = opponent.opponentWins + opponent.opponentLosses;
  if (games === 0) {
    return null; // no record yet (preseason/early week) — nothing honest to say
  }
  const winPct = opponent.opponentWins / games;
  if (winPct >= 0.65) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-500">
        <Flame size={12} /> Tough
      </span>
    );
  }
  if (winPct <= 0.35) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <Shield size={12} /> Winnable
      </span>
    );
  }
  return null;
}

function WeekRow({ week, isCurrentWeek }: { week: ScheduleWeek; isCurrentWeek: boolean }) {
  const [open, setOpen] = useState(isCurrentWeek);
  const played = week.ownPoints !== null && week.opponentPoints !== null;
  const won = played && (week.ownPoints as number) > (week.opponentPoints as number);
  const lost = played && (week.ownPoints as number) < (week.opponentPoints as number);

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        isCurrentWeek ? "border-foreground/20 bg-muted/40" : "border-transparent hover:bg-muted/30",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        <div
          className={cn(
            "size-8 rounded-md flex items-center justify-center text-xs font-bold shrink-0 transition-colors",
            isCurrentWeek ? "bg-foreground text-background" : "bg-muted text-foreground/60",
          )}
        >
          {week.week}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            vs {week.opponentName}
            {isCurrentWeek && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-foreground/50">
                This week
              </span>
            )}
          </p>
          <p className="text-xs text-foreground/50">
            {week.opponentWins}-{week.opponentLosses}
          </p>
        </div>
        {difficultyBadge(week)}
        {played && (
          <span
            className={cn(
              "text-xs font-medium",
              won && "text-emerald-500",
              lost && "text-red-500",
            )}
          >
            {won ? "W" : lost ? "L" : "T"} {week.ownPoints?.toFixed(1)}–
            {week.opponentPoints?.toFixed(1)}
          </span>
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
        <div className="px-3 pb-3 pl-14 text-xs text-foreground/60 flex items-center gap-1.5">
          <Swords size={12} />
          {played
            ? `Final: ${week.ownPoints?.toFixed(1)} – ${week.opponentPoints?.toFixed(1)}`
            : `Opponent has scored ${week.opponentPointsFor.toFixed(1)} points on the season so far.`}
        </div>
      )}
    </div>
  );
}

/** FR: week-by-week opponent schedule — "who am I playing." */
export function ScheduleView({
  weeks,
  currentWeek,
}: {
  weeks: ScheduleWeek[];
  currentWeek: number | null;
}) {
  if (weeks.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        No schedule synced yet — run the sync-league cron job to pull it from Sleeper.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {weeks.map((week) => (
        <WeekRow key={week.week} week={week} isCurrentWeek={week.week === currentWeek} />
      ))}
    </div>
  );
}
