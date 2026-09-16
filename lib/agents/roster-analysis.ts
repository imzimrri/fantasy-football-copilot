import { z } from "zod";
import { generateJSON } from "@/lib/llm";
import { getCurrentFantasyWeek } from "@/lib/sleeper";
import type { Result } from "@/lib/sleeper";
import { research } from "@/lib/perplexity";
import {
  buildCoachDirective,
  buildTeamStrategySummary,
  loadAgentContext,
  loadRosterPlayers,
  replacePendingRecommendations,
} from "@/lib/agents/shared";
import { PREFERRED_SOURCES_NOTE } from "@/lib/agents/preferred-sources";

// `.nullish()` (not `.optional()`) on every optional field below — a real bug hit in
// waiver-research.ts's identical pattern: told to OMIT an optional field, the model
// instead wrote explicit `null`, which `.optional()` rejects and fails the whole call.
const RosterAnalysisOutputSchema = z.object({
  recommendations: z
    .array(
      z.object({
        title: z.string(),
        reasoning: z.string(),
        player: z.string().nullish(),
        action: z.enum(["start", "sit", "flag_injury", "note"]).nullish(),
        // The specific other player this call is weighing against (e.g. the other
        // FLEX/bench option), when the decision is a head-to-head one. Null when it's
        // a standalone flag (injury, bye) with no real alternative being compared.
        comparedTo: z.string().nullish(),
        // Only populated when the research step actually surfaced a real published
        // projection/expert ranking for this player this week — never an LLM guess.
        // Kept as free text (e.g. "14.2 proj pts (FantasyPros)" or "ranked WR22 this
        // week (ESPN)") rather than a bare number, since sources report this
        // differently and a bare number would imply false precision/comparability
        // across sources.
        projection: z.string().nullish(),
      }),
    )
    .min(1),
  // Optional: omitted when there's no opponent data yet (e.g. before matchups sync).
  // Deliberately a qualitative label + reasoning, NOT a fabricated numeric win % — we
  // don't have real per-player projections to back a number, and presenting fake
  // precision as fact would violate the "never fabricate data" rule this app follows
  // everywhere else (see project_context.md).
  matchupOutlook: z
    .object({
      confidence: z.enum(["favorable", "toss_up", "tough"]),
      reasoning: z.string(),
    })
    .nullish(),
});

/**
 * FR5-9: start/sit recommendations, opponent-aware, with injury/bye flags. Also
 * produces one "matchup" recommendation (category: matchup) — a qualitative
 * favorable/toss-up/tough read on this week's matchup, shown on the dashboard.
 * Reads the synced roster + this week's opponent, asks the LLM to reason about
 * lineup decisions, writes results to `recommendations`.
 */
export async function runRosterAnalysis(): Promise<Result<{ recommendationCount: number }>> {
  const contextResult = await loadAgentContext();
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

  const weekResult = await getCurrentFantasyWeek();
  if (!weekResult.ok) return weekResult;
  const week = weekResult.data;

  // Opponent (best-effort — may not exist yet in preseason/before matchups sync).
  let opponentSummary = "No opponent data available for this week yet.";
  let opponentName: string | null = null;
  const { data: matchup } = await ctx.db
    .from("matchups")
    .select("opponent_roster_id")
    .eq("league_id", ctx.leagueId)
    .eq("week", week)
    .eq("roster_id", ctx.ownRosterId)
    .maybeSingle();

  if (matchup?.opponent_roster_id) {
    const [opponentPlayersResult, opponentRosterResult] = await Promise.all([
      loadRosterPlayers(ctx.db, matchup.opponent_roster_id as string),
      ctx.db
        .from("rosters")
        .select("owner_display_name")
        .eq("id", matchup.opponent_roster_id as string)
        .single(),
    ]);
    if (opponentPlayersResult.ok) {
      opponentSummary = opponentPlayersResult.data
        .filter((p) => p.isStarter)
        .map((p) => `${p.fullName} (${p.position}, ${p.team ?? "FA"})`)
        .join(", ");
    }
    opponentName = (opponentRosterResult.data?.owner_display_name as string | null) ?? null;
  }

  const rosterSummary = ctx.ownRosterPlayers
    .map(
      (p) =>
        `${p.fullName} — ${p.position ?? "?"} ${p.team ?? "FA"} — ${
          p.isStarter ? "STARTER" : "bench"
        }${p.status ? ` — status: ${p.status}` : ""}`,
    )
    .join("\n");

  // Research step (Perplexity): grounds reasoning in current, cited news instead of
  // just the LLM's own recall — degrades gracefully if unset/unavailable, per the
  // Integration Reliability NFR, since this is an enhancement, not a hard dependency.
  const rosterNames = ctx.ownRosterPlayers.map((p) => p.fullName).join(", ");
  const researchResult = await research(
    `Current NFL injury reports, questionable/doubtful statuses, and depth chart ` +
      `changes this week for these fantasy football players: ${rosterNames}. Also, for ` +
      `each player, their real NFL opponent this week and how tough that matchup is ` +
      `(e.g. opponent's run/pass defense ranking), and any published expert fantasy ` +
      `point projections, rest-of-week rankings, or start/sit consensus calls from ` +
      `sites like FantasyPros, ESPN, PFF, or NFL.com — especially for players who are ` +
      `competing for the same lineup spot (e.g. two flex-eligible options).` +
      PREFERRED_SOURCES_NOTE,
  );
  if (!researchResult.ok) {
    console.warn("[roster-analysis] Perplexity research degraded:", researchResult.error);
  }
  const researchContext = researchResult.ok
    ? `\n\nCurrent news research:\n${researchResult.data.answer}`
    : "";
  const sources = researchResult.ok ? researchResult.data.sources : [];

  // The user's own stated reasoning for holding certain roster players (e.g. "handcuff
  // in case Mahomes gets hurt"). If a note applies to a player this agent is about to
  // flag, it must be addressed directly rather than silently ignored.
  const notesLines = ctx.ownRosterPlayers
    .map((p) => {
      const note = ctx.playerNotes.get(p.sleeperPlayerId);
      return note ? `${p.fullName}: "${note}"` : null;
    })
    .filter(Boolean);
  const notesSummary =
    notesLines.length > 0
      ? `\n\nThe user's own stated reasoning for holding certain roster players — if any ` +
        `of these players come up in your recommendations, address the reasoning ` +
        `directly (confirm it or explain specifically why it's wrong) rather than ` +
        `ignoring it:\n${notesLines.join("\n")}`
      : "";

  const llmResult = await generateJSON({
    system:
      "You are a fantasy football roster analyst. Given a user's roster, league " +
      "scoring settings, their opponent's starters for the week, and current news " +
      "research, recommend specific start/sit decisions and flag any injured/bye " +
      "players. Every recommendation needs concrete reasoning tied to the actual " +
      "players listed — never invent players not in the roster. Prefer the current " +
      "news research over your own general knowledge when they conflict, since it's " +
      "more recent. Only state a specific factual claim about a player's current " +
      "depth-chart position, role, or snap share if it's backed by the research " +
      "provided — do not state a specific depth-chart ranking from memory, since your " +
      "training data may be outdated.\n\n" +
      "For every spot where two rostered players are realistically competing for the " +
      "same lineup slot (e.g. two flex-eligible players, a bench player who could " +
      "start over a struggling starter), make it an explicit head-to-head call: set " +
      "`comparedTo` to the other player's name and give reasoning that directly " +
      "compares them — their real NFL opponent this week and how tough that matchup " +
      "is, not just each player in isolation. Set `projection` ONLY when the research " +
      "provided a real published projection, ranking, or start/sit consensus for that " +
      "player this week (quote it plus its source, e.g. \"14.2 proj pts " +
      "(FantasyPros)\") — never estimate or invent a number yourself; leave it null " +
      "when the research didn't cover that player.\n\n" +
      "If opponent data is available, also give a matchupOutlook: a " +
      "qualitative confidence read (favorable/toss_up/tough) comparing the two " +
      "rosters' starting lineups for THIS week specifically — positional strength, " +
      "injury situations, depth. Do not invent or imply a numeric win probability; " +
      "there's no real projection data to back one. If no opponent data was given, " +
      "omit matchupOutlook entirely." +
      buildCoachDirective(),
    prompt:
      `League scoring settings: ${JSON.stringify(ctx.scoringSettings)}\n` +
      `Roster positions required: ${JSON.stringify(ctx.rosterPositions)}\n\n` +
      `My roster (week ${week}):\n${rosterSummary}\n\n` +
      `Opponent's likely starters: ${opponentSummary}` +
      notesSummary +
      buildTeamStrategySummary(ctx.teamStrategyNotes) +
      researchContext +
      `\n\nReturn JSON: { "recommendations": [{ "title": string, "reasoning": string, ` +
      `"player": string, "action": "start"|"sit"|"flag_injury"|"note", ` +
      `"comparedTo": string (optional), "projection": string (optional) }], ` +
      `"matchupOutlook": { "confidence": "favorable"|"toss_up"|"tough", "reasoning": string } (optional) }. ` +
      `Cover every borderline start/sit decision and flag any injured/bye players.`,
    schema: RosterAnalysisOutputSchema,
  });

  if (!llmResult.ok) return llmResult;

  const startSitResult = await replacePendingRecommendations(ctx.db, {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    category: "start_sit",
    week,
    rows: llmResult.data.recommendations.map((r) => ({
      title: r.title,
      reasoning: r.reasoning,
      sources,
      payload: { player: r.player, action: r.action, comparedTo: r.comparedTo, projection: r.projection },
    })),
  });
  if (!startSitResult.ok) return startSitResult;

  let matchupCount = 0;
  if (llmResult.data.matchupOutlook) {
    const outlook = llmResult.data.matchupOutlook;
    const matchupResult = await replacePendingRecommendations(ctx.db, {
      userId: ctx.userId,
      leagueId: ctx.leagueId,
      category: "matchup",
      week,
      rows: [
        {
          title: opponentName ? `This Week vs ${opponentName}` : "This Week's Matchup",
          reasoning: outlook.reasoning,
          sources,
          payload: { confidence: outlook.confidence, opponentName },
        },
      ],
    });
    if (!matchupResult.ok) return matchupResult;
    matchupCount = matchupResult.data;
  }

  return { ok: true, data: { recommendationCount: startSitResult.data + matchupCount } };
}
