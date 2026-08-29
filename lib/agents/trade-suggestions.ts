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

const CORE_POSITIONS = ["QB", "RB", "WR", "TE", "K"] as const;
type CorePosition = (typeof CORE_POSITIONS)[number];

interface RosterPositionCounts {
  rosterId: string;
  displayName: string;
  counts: Record<CorePosition, number>;
}

/**
 * Pure roster-construction math — exported and tested independently of any LLM call.
 * Counts rostered players per core position (no FLEX/SUPER_FLEX slot-allocation
 * modeling; that gets genuinely ambiguous, so this stays a simple, defensible signal:
 * "how many RBs/WRs/etc. does each team actually own"), then finds each team's most
 * above-average (surplus) and most below-average (need) position relative to the
 * league.
 */
export function computeSurplusAndNeed(
  rosters: RosterPositionCounts[],
): Map<string, { surplus: CorePosition; need: CorePosition }> {
  const leagueAverage: Record<CorePosition, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
  };
  for (const pos of CORE_POSITIONS) {
    leagueAverage[pos] =
      rosters.reduce((sum, r) => sum + r.counts[pos], 0) / (rosters.length || 1);
  }

  const result = new Map<string, { surplus: CorePosition; need: CorePosition }>();
  for (const roster of rosters) {
    let surplus: CorePosition = "RB";
    let need: CorePosition = "RB";
    let maxDiff = -Infinity;
    let minDiff = Infinity;
    for (const pos of CORE_POSITIONS) {
      const diff = roster.counts[pos] - leagueAverage[pos];
      if (diff > maxDiff) {
        maxDiff = diff;
        surplus = pos;
      }
      if (diff < minDiff) {
        minDiff = diff;
        need = pos;
      }
    }
    result.set(roster.rosterId, { surplus, need });
  }
  return result;
}

/**
 * Finds the best complementary trade partner: the team whose surplus best matches my
 * need, and whose need best matches my surplus. Exported/tested independently.
 */
export function findBestTradePartner(
  myRosterId: string,
  rosters: RosterPositionCounts[],
): { partnerRosterId: string; myNeed: CorePosition; mySurplus: CorePosition } | null {
  const profiles = computeSurplusAndNeed(rosters);
  const mine = profiles.get(myRosterId);
  if (!mine) return null;

  const leagueAverage: Record<CorePosition, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
  };
  for (const pos of CORE_POSITIONS) {
    leagueAverage[pos] =
      rosters.reduce((sum, r) => sum + r.counts[pos], 0) / (rosters.length || 1);
  }

  let best: { partnerRosterId: string; score: number } | null = null;
  for (const roster of rosters) {
    if (roster.rosterId === myRosterId) continue;
    // Score: how much surplus they have at what I need, plus how much need they have
    // at what I have surplus in (a genuinely complementary fit, not just "has a lot").
    const theirSurplusAtMyNeed = roster.counts[mine.need] - leagueAverage[mine.need];
    const theirNeedAtMySurplus = leagueAverage[mine.surplus] - roster.counts[mine.surplus];
    const score = theirSurplusAtMyNeed + theirNeedAtMySurplus;
    if (!best || score > best.score) {
      best = { partnerRosterId: roster.rosterId, score };
    }
  }

  if (!best) return null;
  return { partnerRosterId: best.partnerRosterId, myNeed: mine.need, mySurplus: mine.surplus };
}

const TradeSuggestionSchema = z.object({
  // Optional — "the numbers don't support a good trade with this team right now" is a
  // legitimate, honest outcome, not a failure. Never force a bad suggestion.
  // `.nullish()` not `.optional()` — see waiver-research.ts's buildWaiverOutputSchema
  // comment: models sometimes write explicit `null` for an omitted optional field.
  tradeIdea: z
    .object({
      proposedGive: z.string(),
      proposedReceive: z.string(),
      reasoning: z.string(),
      mutualBenefitReasoning: z
        .string()
        .min(1, "must explain why the OTHER team would plausibly accept — a one-sided ask isn't a real suggestion"),
      restOfSeasonOutlook: z.string(),
    })
    .nullish(),
});

/**
 * FR17: proactively suggests a trade the user hasn't been offered — the capability
 * deliberately left out of trade-evaluation.ts, since it needs a fundamentally
 * different analysis (scanning every roster in the league for complementary needs,
 * not just evaluating one specific received offer). Runs the roster-construction math
 * in plain code (cheap, deterministic) and only spends an LLM call on synthesizing the
 * one best candidate idea — not one call per possible partner, per the Cost
 * Efficiency NFR.
 */
export async function runTradeSuggestions(): Promise<Result<{ recommendationCount: number }>> {
  const contextResult = await loadAgentContext();
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

  const weekResult = await getCurrentFantasyWeek();
  if (!weekResult.ok) return weekResult;
  const week = weekResult.data;

  const { data: allRosters, error: rostersError } = await ctx.db
    .from("rosters")
    .select("id, owner_display_name")
    .eq("league_id", ctx.leagueId);

  if (rostersError || !allRosters) {
    return { ok: false, error: `Failed to load league rosters: ${rostersError?.message}` };
  }

  const { data: allRosterPlayers, error: rpError } = await ctx.db
    .from("roster_players")
    .select("roster_id, players(position)")
    .in(
      "roster_id",
      allRosters.map((r) => r.id),
    );

  if (rpError) {
    return { ok: false, error: `Failed to load league roster compositions: ${rpError.message}` };
  }

  const rosterPositionCounts: RosterPositionCounts[] = allRosters.map((roster) => {
    const counts: Record<CorePosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0 };
    for (const rp of allRosterPlayers ?? []) {
      if (rp.roster_id !== roster.id) continue;
      const player = Array.isArray(rp.players) ? rp.players[0] : rp.players;
      const position = player?.position as CorePosition | undefined;
      if (position && CORE_POSITIONS.includes(position)) counts[position] += 1;
    }
    return {
      rosterId: roster.id,
      displayName: (roster.owner_display_name as string | null) ?? "Unknown",
      counts,
    };
  });

  const match = findBestTradePartner(ctx.ownRosterId, rosterPositionCounts);
  if (!match) {
    return { ok: true, data: { recommendationCount: 0 } };
  }

  const partner = rosterPositionCounts.find((r) => r.rosterId === match.partnerRosterId);
  if (!partner) return { ok: true, data: { recommendationCount: 0 } };

  const partnerPlayersAtMyNeed = ctx.ownRosterPlayers.length
    ? await ctx.db
        .from("roster_players")
        .select("sleeper_player_id, players(full_name, position, team, status)")
        .eq("roster_id", match.partnerRosterId)
    : { data: [] };

  const partnerNeedPositionPlayers = (partnerPlayersAtMyNeed.data ?? [])
    .map((rp) => (Array.isArray(rp.players) ? rp.players[0] : rp.players))
    .filter((p) => p?.position === match.myNeed);

  const mySurplusPositionPlayers = ctx.ownRosterPlayers.filter(
    (p) => p.position === match.mySurplus,
  );

  if (partnerNeedPositionPlayers.length === 0 || mySurplusPositionPlayers.length === 0) {
    return { ok: true, data: { recommendationCount: 0 } };
  }

  const researchResult = await research(
    `For fantasy football rest-of-season trade value, compare these two groups of ` +
      `players: Group A (mine, position ${match.mySurplus}): ` +
      `${mySurplusPositionPlayers.map((p) => p.fullName).join(", ")}. Group B (target, ` +
      `position ${match.myNeed}): ` +
      `${partnerNeedPositionPlayers.map((p) => p?.full_name).join(", ")}. Include role, ` +
      `opportunity, and recent news for each.`,
  );
  if (!researchResult.ok) {
    console.warn("[trade-suggestions] Perplexity research degraded:", researchResult.error);
  }
  const researchContext = researchResult.ok
    ? `\n\nCurrent news research:\n${researchResult.data.answer}`
    : "";
  const sources = researchResult.ok ? researchResult.data.sources : [];

  const rosterSummary = ctx.ownRosterPlayers
    .map((p) => `${p.fullName} — ${p.position ?? "?"} ${p.team ?? "FA"} — ${p.isStarter ? "STARTER" : "bench"}`)
    .join("\n");

  // The user's own stated reasoning for holding any of the candidates being
  // considered to offer in this trade — e.g. "I'm OK trading him" is itself a note
  // worth surfacing, same as a handcuff note argues against offering someone.
  const surplusNotesLines = mySurplusPositionPlayers
    .map((p) => {
      const note = ctx.playerNotes.get(p.sleeperPlayerId);
      return note ? `${p.fullName}: "${note}"` : null;
    })
    .filter((line): line is string => !!line);
  const surplusNotesSummary =
    surplusNotesLines.length > 0
      ? `\n\nThe user's own stated reasoning for these ${match.mySurplus} players — ` +
        `factor it in directly (a note saying they're fine trading someone makes them ` +
        `a BETTER candidate to offer; a note explaining why they're keeping someone ` +
        `argues against offering them):\n${surplusNotesLines.join("\n")}`
      : "";

  const llmResult = await generateJSON({
    system:
      "You are the user's trade strategist — you work FOR them, not as a neutral " +
      "referee. You've identified a team with a complementary roster fit: they " +
      "likely have surplus depth at a position the user needs, and likely need depth " +
      "at a position where the user has surplus. Propose ONE specific trade that " +
      "leans toward the user's benefit while still being realistic enough that the " +
      "other team would plausibly accept — offer the LEAST valuable player(s) from " +
      "the user's surplus that still gets the deal done, and target the MOST " +
      "valuable player(s) from the other team's need position that they'd " +
      "realistically part with. A trade so lopsided it would obviously be declined " +
      "isn't useful either — the goal is the best deal the user can actually get, " +
      "not the fairest possible split. If the specific players available don't " +
      "support a good trade, omit tradeIdea entirely rather than forcing one. Never " +
      "invent players not listed. Only state a specific factual claim about a " +
      "player's current depth-chart position, role, or snap share if it's backed by " +
      "the research provided — do not state a specific depth-chart ranking from " +
      "memory, since your training data may be outdated." +
      buildCoachDirective(),
    prompt:
      `League scoring settings: ${JSON.stringify(ctx.scoringSettings)}\n` +
      `Roster positions required (note SUPER_FLEX/FLEX slots affect position value — ` +
      `e.g. a league with SUPER_FLEX values QBs much more highly than a standard ` +
      `1-QB league): ${JSON.stringify(ctx.rosterPositions)}\n\n` +
      `My full roster:\n${rosterSummary}\n\n` +
      `I likely have surplus at ${match.mySurplus} and need at ${match.myNeed} ` +
      `(based on roster composition vs. league average).\n\n` +
      `${partner.displayName} likely has surplus at ${match.myNeed} and need at ` +
      `${match.mySurplus}.\n\n` +
      `My ${match.mySurplus} players I could offer: ${mySurplusPositionPlayers.map((p) => p.fullName).join(", ")}\n` +
      `Their ${match.myNeed} players I could target: ${partnerNeedPositionPlayers.map((p) => p?.full_name).join(", ")}` +
      surplusNotesSummary +
      buildTeamStrategySummary(ctx.teamStrategyNotes) +
      researchContext +
      `\n\nReturn JSON: { "tradeIdea": { "proposedGive": string, "proposedReceive": string, ` +
      `"reasoning": string, "mutualBenefitReasoning": string, "restOfSeasonOutlook": string } (optional) }.`,
    schema: TradeSuggestionSchema,
  });

  if (!llmResult.ok) return llmResult;

  const rows = llmResult.data.tradeIdea
    ? [
        {
          title: `Trade Idea: ${llmResult.data.tradeIdea.proposedReceive} from ${partner.displayName}`,
          reasoning: llmResult.data.tradeIdea.reasoning,
          sources,
          payload: {
            type: "suggestion",
            proposedGive: llmResult.data.tradeIdea.proposedGive,
            proposedReceive: llmResult.data.tradeIdea.proposedReceive,
            targetTeamName: partner.displayName,
            mutualBenefitReasoning: llmResult.data.tradeIdea.mutualBenefitReasoning,
            restOfSeasonOutlook: llmResult.data.tradeIdea.restOfSeasonOutlook,
          },
        },
      ]
    : [];

  const insertResult = await replacePendingRecommendations(ctx.db, {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    category: "trade",
    week,
    payloadTypeEquals: "suggestion",
    rows,
  });

  if (!insertResult.ok) return insertResult;
  return { ok: true, data: { recommendationCount: insertResult.data } };
}
