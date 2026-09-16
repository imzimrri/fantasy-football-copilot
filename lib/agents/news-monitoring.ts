import { z } from "zod";
import { generateJSON } from "@/lib/llm";
import { getCurrentFantasyWeek } from "@/lib/sleeper";
import type { Result } from "@/lib/sleeper";
import { research } from "@/lib/perplexity";
import { loadAgentContext, replacePendingRecommendations } from "@/lib/agents/shared";
import { PREFERRED_SOURCES_NOTE } from "@/lib/agents/preferred-sources";

const NewsOutputSchema = z.object({
  // Deliberately NOT `.min(1)` — unlike waiver/roster-analysis, "nothing newsworthy
  // happened today" is a common, legitimate outcome for a news scan, not a failure.
  newsItems: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      // `.nullish()` not `.optional()` — see waiver-research.ts's
      // buildWaiverOutputSchema comment: models sometimes write explicit `null` for an
      // omitted optional field.
      player: z.string().nullish(),
      rosterImpact: z.string().nullish(),
    }),
  ),
});

/**
 * FR18-21: dedicated news/injury scan across the FULL roster (starters + bench), not
 * just the lightweight per-run check inside roster-analysis/waiver-research. Produces
 * one recommendation per genuinely newsworthy item (category: news) — role changes,
 * depth-chart shifts, injury updates, anything with real fantasy relevance. An empty
 * result is normal, not an error.
 */
export async function runNewsMonitoring(): Promise<Result<{ recommendationCount: number }>> {
  const contextResult = await loadAgentContext();
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

  const weekResult = await getCurrentFantasyWeek();
  if (!weekResult.ok) return weekResult;
  const week = weekResult.data;

  const allNames = ctx.ownRosterPlayers.map((p) => p.fullName).join(", ");
  const researchResult = await research(
    `Any breaking NFL news, injury updates, depth chart changes, role changes, or ` +
      `beat-writer reports from the last 24-48 hours for these fantasy football ` +
      `players: ${allNames}. Only include genuinely new/notable items, not routine ` +
      `status quo confirmations.` +
      PREFERRED_SOURCES_NOTE,
  );

  if (!researchResult.ok) return researchResult;
  const sources = researchResult.data.sources;

  const llmResult = await generateJSON({
    system:
      "You are a fantasy football news monitor. Given research on recent news for " +
      "the user's full roster, identify genuinely newsworthy items with real fantasy " +
      "relevance — role changes, injuries, depth chart shifts, suspensions, etc. Do " +
      "NOT invent news or pad the list with routine/non-newsworthy items just to have " +
      "something to report — if nothing meaningful happened, return an empty array. " +
      "For each item, note the roster impact if there is one (e.g. 'monitor for " +
      "start/sit', 'consider a waiver add of the backup').",
    prompt:
      `My full roster:\n${ctx.ownRosterPlayers.map((p) => `${p.fullName} (${p.position ?? "?"} ${p.team ?? "FA"})`).join("\n")}\n\n` +
      `Research findings:\n${researchResult.data.answer}\n\n` +
      `Return JSON: { "newsItems": [{ "title": string, "summary": string, ` +
      `"player": string (optional), "rosterImpact": string (optional) }] }. ` +
      `Empty array if nothing genuinely newsworthy.`,
    schema: NewsOutputSchema,
  });

  if (!llmResult.ok) return llmResult;

  const insertResult = await replacePendingRecommendations(ctx.db, {
    userId: ctx.userId,
    leagueId: ctx.leagueId,
    category: "news",
    week,
    rows: llmResult.data.newsItems.map((item) => ({
      title: item.title,
      reasoning: item.summary,
      sources,
      payload: { player: item.player, rosterImpact: item.rosterImpact },
    })),
  });

  if (!insertResult.ok) return insertResult;
  return { ok: true, data: { recommendationCount: insertResult.data } };
}
