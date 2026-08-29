import { z } from "zod";
import { generateJSON } from "@/lib/llm";
import { getCurrentFantasyWeek } from "@/lib/sleeper";
import type { Result } from "@/lib/sleeper";
import { research } from "@/lib/perplexity";
import {
  buildCoachDirective,
  buildTeamStrategySummary,
  loadAgentContext,
  replacePendingRecommendations,
} from "@/lib/agents/shared";

const TradeEvaluationSchema = z.object({
  action: z.enum(["accept", "decline", "counter"]),
  reasoning: z.string(),
  restOfSeasonOutlook: z
    .string()
    .min(1, "restOfSeasonOutlook is required — a trade is a season-long decision"),
  // `.nullish()` not `.optional()` — see waiver-research.ts's buildWaiverOutputSchema
  // comment: models sometimes write explicit `null` for an omitted optional field.
  counterSuggestion: z.string().nullish(),
});

/**
 * Pure extraction of "what do I receive / what do I give up" from Sleeper's trade
 * shape — split out and exported specifically so this correctness-critical mapping is
 * unit-testable without a live pending trade to test against. Sleeper's `adds`/`drops`
 * are `{ sleeper_player_id: sleeper_roster_id }` maps: a player appearing in `adds`
 * under MY roster id means I receive them; appearing in `drops` under my roster id
 * means I give them up. Getting this backwards would silently evaluate every trade
 * as its own inverse.
 */
export function resolveTradeSides(
  adds: Record<string, number>,
  drops: Record<string, number>,
  ownSleeperRosterId: number,
): { receiving: string[]; giving: string[] } {
  const receiving = Object.entries(adds)
    .filter(([, rosterId]) => rosterId === ownSleeperRosterId)
    .map(([playerId]) => playerId);
  const giving = Object.entries(drops)
    .filter(([, rosterId]) => rosterId === ownSleeperRosterId)
    .map(([playerId]) => playerId);
  return { receiving, giving };
}

interface TradeRow {
  id: string;
  sleeper_transaction_id: string;
  roster_ids_involved: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
}

/**
 * FR14-16: evaluates real pending trade offers synced from Sleeper (not a manually
 * entered form — Sleeper's transactions endpoint exposes actual trade proposals
 * involving the user's roster). For each pending trade, recommends accept/decline/
 * counter with reasoning, a season-long outlook (a trade is even more permanent than a
 * waiver drop), and current news research on the players involved.
 *
 * FR17 (proactively suggesting trades the user hasn't been offered) is NOT built here —
 * that's a fundamentally different capability (scanning every roster in the league for
 * complementary needs) and is scoped as a separate follow-up, not bundled in.
 */
export async function runTradeEvaluation(): Promise<Result<{ recommendationCount: number }>> {
  const contextResult = await loadAgentContext();
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

  const weekResult = await getCurrentFantasyWeek();
  if (!weekResult.ok) return weekResult;
  const week = weekResult.data;

  const { data: pendingTrades, error: tradesError } = await ctx.db
    .from("trades")
    .select("id, sleeper_transaction_id, roster_ids_involved, adds, drops")
    .eq("league_id", ctx.leagueId)
    .eq("status", "pending");

  if (tradesError) {
    return { ok: false, error: `Failed to load pending trades: ${tradesError.message}` };
  }

  if (!pendingTrades || pendingTrades.length === 0) {
    // No pending trades is a normal, common state — not a failure.
    const clearResult = await replacePendingRecommendations(ctx.db, {
      userId: ctx.userId,
      leagueId: ctx.leagueId,
      category: "trade",
      week,
      payloadTypeEquals: "received_offer",
      rows: [],
    });
    if (!clearResult.ok) return clearResult;
    return { ok: true, data: { recommendationCount: 0 } };
  }

  const rosterNameById = new Map(ctx.ownRosterPlayers.map((p) => [p.sleeperPlayerId, p.fullName]));

  const rows: Array<{
    title: string;
    reasoning: string;
    sources: Array<{ title: string; url: string }>;
    payload: Record<string, unknown>;
  }> = [];

  for (const trade of pendingTrades as TradeRow[]) {
    const adds = trade.adds ?? {};
    const drops = trade.drops ?? {};

    const { receiving: receivingPlayerIds, giving: givingPlayerIds } = resolveTradeSides(
      adds,
      drops,
      ctx.ownSleeperRosterId,
    );

    if (receivingPlayerIds.length === 0 && givingPlayerIds.length === 0) continue;

    // Resolve player names — own-roster players are already in context; anything else
    // (players coming from the other side) needs a lookup against the players cache.
    const allPlayerIds = [...receivingPlayerIds, ...givingPlayerIds];
    const { data: playerRows } = await ctx.db
      .from("players")
      .select("sleeper_player_id, full_name, position, team")
      .in("sleeper_player_id", allPlayerIds);
    const playerInfoById = new Map((playerRows ?? []).map((p) => [p.sleeper_player_id, p]));

    const describe = (playerId: string) => {
      const info = playerInfoById.get(playerId);
      const fullName = info?.full_name ?? rosterNameById.get(playerId) ?? playerId;
      const position = info?.position;
      const team = info?.team;
      return `${fullName}${position ? ` (${position}${team ? ` ${team}` : ""})` : ""}`;
    };

    const receivingSummary = receivingPlayerIds.map(describe).join(", ") || "nothing";
    const givingSummary = givingPlayerIds.map(describe).join(", ") || "nothing";

    // The user's own stated reasoning for holding any player THIS specific trade
    // would give up — only the relevant subset, not the whole roster's notes.
    const givingNotesLines = givingPlayerIds
      .map((id) => {
        const note = ctx.playerNotes.get(id);
        return note ? `${describe(id)}: "${note}"` : null;
      })
      .filter((line): line is string => !!line);
    const givingNotesSummary =
      givingNotesLines.length > 0
        ? `\n\nThe user's own stated reasoning for holding a player this trade would ` +
          `give up — address it directly (confirm it or explain why it doesn't hold ` +
          `here):\n${givingNotesLines.join("\n")}`
        : "";

    const otherRosterSleeperId = trade.roster_ids_involved.find(
      (id) => id !== ctx.ownSleeperRosterId,
    );
    const { data: otherRoster } = otherRosterSleeperId
      ? await ctx.db
          .from("rosters")
          .select("owner_display_name")
          .eq("league_id", ctx.leagueId)
          .eq("sleeper_roster_id", otherRosterSleeperId)
          .maybeSingle()
      : { data: null };
    const otherTeamName = otherRoster?.owner_display_name ?? "another team";

    const rosterSummary = ctx.ownRosterPlayers
      .map((p) => `${p.fullName} — ${p.position ?? "?"} ${p.team ?? "FA"} — ${p.isStarter ? "STARTER" : "bench"}`)
      .join("\n");

    const researchResult = await research(
      `For fantasy football rest-of-season value, compare: ${receivingSummary} vs ${givingSummary}. ` +
        `Include recent news, role/opportunity, and injury status for each player.`,
    );
    if (!researchResult.ok) {
      console.warn("[trade-evaluation] Perplexity research degraded:", researchResult.error);
    }
    const researchContext = researchResult.ok
      ? `\n\nCurrent news research on the players involved:\n${researchResult.data.answer}`
      : "";
    const sources = researchResult.ok ? researchResult.data.sources : [];

    const llmResult = await generateJSON({
      system:
        "You are a fantasy football trade analyst. Evaluate a real pending trade " +
        "offer for the user's roster. A trade is a SEASON-LONG, harder-to-reverse " +
        "decision than a waiver drop — weigh rest-of-season value, not just this " +
        "week. Recommend accept, decline, or counter, with concrete reasoning tied to " +
        "the actual players and the league's scoring format. If countering, suggest a " +
        "specific alternative. Only state a specific factual claim about a player's " +
        "current depth-chart position, role, or snap share if it's backed by the " +
        "research provided — do not state a specific depth-chart ranking from " +
        "memory, since your training data may be outdated.\n\n" +
        "The user may have written their own reasoning for holding a player this " +
        "trade would give up. Engage with it directly — confirm it still holds and " +
        "weigh it against the trade, or explain specifically why it doesn't apply " +
        "here. Never silently ignore it." +
        buildCoachDirective(),
      prompt:
        `League scoring settings: ${JSON.stringify(ctx.scoringSettings)}\n` +
        `Roster positions required (note SUPER_FLEX/FLEX slots affect position value — ` +
        `e.g. a league with SUPER_FLEX values QBs much more highly than a standard ` +
        `1-QB league): ${JSON.stringify(ctx.rosterPositions)}\n\n` +
        `My full roster:\n${rosterSummary}\n\n` +
        `Trade offer from ${otherTeamName}:\n` +
        `I would receive: ${receivingSummary}\n` +
        `I would give up: ${givingSummary}` +
        givingNotesSummary +
        buildTeamStrategySummary(ctx.teamStrategyNotes) +
        researchContext +
        `\n\nReturn JSON: { "action": "accept"|"decline"|"counter", "reasoning": string, ` +
        `"restOfSeasonOutlook": string, "counterSuggestion": string (optional) }.`,
      schema: TradeEvaluationSchema,
    });

    if (!llmResult.ok) {
      console.warn(`[trade-evaluation] LLM call failed for trade ${trade.sleeper_transaction_id}:`, llmResult.error);
      continue; // one bad trade evaluation shouldn't block evaluating the others
    }

    rows.push({
      title: `Trade: Receive ${receivingSummary} for ${givingSummary}`,
      reasoning: llmResult.data.reasoning,
      sources,
      payload: {
        type: "received_offer",
        action: llmResult.data.action,
        receive: receivingSummary,
        give: givingSummary,
        otherTeamName,
        counterSuggestion: llmResult.data.counterSuggestion,
        restOfSeasonOutlook: llmResult.data.restOfSeasonOutlook,
        sleeperTransactionId: trade.sleeper_transaction_id,
      },
    });
  }

  const insertResult = await replacePendingRecommendations(ctx.db, {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    category: "trade",
    week,
    payloadTypeEquals: "received_offer",
    rows,
  });

  if (!insertResult.ok) return insertResult;
  return { ok: true, data: { recommendationCount: insertResult.data } };
}
