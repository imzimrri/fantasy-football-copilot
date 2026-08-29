import { fuzzyMatchName } from "@/lib/fuzzy-match";
import { LineupRow } from "@/components/lineup-row";
import type { AgentPlayer } from "@/lib/agents/shared";
import type { Recommendation } from "@/lib/types";

/**
 * FR5/FR8/FR9: the weekly lineup view — starters grouped in the league's actual slot
 * order (QB, RB, RB, WR, WR, TE, FLEX, FLEX, SUPER_FLEX, K, ...), each paired with our
 * recommendation for that specific player this week, or an explicit "leave as is" when
 * the agent had nothing to flag for them. Modeled on Sleeper's own lineup layout.
 */
export function LineupView({
  players,
  recommendations,
  rosterPositions,
  notes = new Map(),
}: {
  players: AgentPlayer[];
  recommendations: Recommendation[];
  rosterPositions: string[] | null;
  /** sleeperPlayerId -> the user's own stated reasoning for holding them, if any. */
  notes?: Map<string, string>;
}) {
  const starters = players.filter((p) => p.isStarter);
  const bench = players.filter((p) => !p.isStarter);

  // Sort starters into the league's actual slot order — a stable sort keeps two same-
  // slot starters (e.g. both RB1/RB2) in their original relative order.
  const starterSlotOrder = (rosterPositions ?? []).filter((p) => p !== "BN");
  const sortedStarters = [...starters].sort((a, b) => {
    const ai = starterSlotOrder.indexOf(a.rosterSlot ?? "");
    const bi = starterSlotOrder.indexOf(b.rosterSlot ?? "");
    return ai - bi;
  });

  // Match each start/sit recommendation to the player it's about — fuzzy, since the
  // LLM's payload.player string doesn't always exactly match the stored full name.
  const playerNames = players.map((p) => p.fullName);
  const recByPlayerName = new Map<string, Recommendation>();
  for (const rec of recommendations) {
    if (rec.category !== "start_sit") continue;
    const rawName = rec.payload.player as string | undefined;
    if (!rawName) continue;
    const matched = fuzzyMatchName(rawName, playerNames);
    if (matched && !recByPlayerName.has(matched)) {
      recByPlayerName.set(matched, rec);
    }
  }

  if (players.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        No roster data yet — run the sync-league cron job (or trigger it manually
        while testing) to pull your roster from Sleeper.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-medium text-sm text-foreground/60 uppercase tracking-wide mb-1">
          Starters
        </h2>
        <div className="flex flex-col">
          {sortedStarters.map((player) => (
            <LineupRow
              key={player.sleeperPlayerId}
              player={player}
              recommendation={recByPlayerName.get(player.fullName) ?? null}
              note={notes.get(player.sleeperPlayerId) ?? null}
            />
          ))}
        </div>
      </div>
      <div>
        <h2 className="font-medium text-sm text-foreground/60 uppercase tracking-wide mb-1">
          Bench
        </h2>
        <div className="flex flex-col">
          {bench.map((player) => (
            <LineupRow
              key={player.sleeperPlayerId}
              player={player}
              recommendation={recByPlayerName.get(player.fullName) ?? null}
              note={notes.get(player.sleeperPlayerId) ?? null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
