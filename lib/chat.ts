import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/llm";
import { getCurrentFantasyWeek } from "@/lib/sleeper";
import type { Result } from "@/lib/sleeper";
import { research, type ResearchSource } from "@/lib/perplexity";
import { fuzzyMatchName } from "@/lib/fuzzy-match";
import { buildTeamStrategySummary, loadLeagueRosterContext } from "@/lib/agents/shared";
import { PREFERRED_SOURCES_NOTE } from "@/lib/agents/preferred-sources";

const CHAT_HISTORY_LIMIT = 20;
// How many of this week's already-computed waiver/news recommendations to fold into
// chat context — enough to actually be useful, capped so the prompt doesn't balloon.
const RECOMMENDATION_CONTEXT_LIMIT = 8;

// `.nullish()` not `.optional()` on the two optional top-level fields — see
// waiver-research.ts's buildWaiverOutputSchema comment: models sometimes write
// explicit `null` for an omitted optional field, which `.optional()` alone rejects.
const ChatOutputSchema = z.object({
  reply: z.string(),
  // A note with an empty string CLEARS an existing per-player note (e.g. the user
  // reversing a prior stance, like deciding to drop a handcuff they were stashing).
  playerNoteUpdates: z.array(z.object({ player: z.string(), note: z.string() })).nullish(),
  teamStrategyNote: z.string().nullish(),
});

/**
 * One turn of the chat copilot — grounded in the same real roster/notes/watchlist
 * context every cron agent uses (`loadLeagueRosterContext`), but invoked from an
 * authenticated Server Action via the session-scoped client, not a cron job. Directly
 * persists any directive the user states in plain language: a statement about ONE
 * player becomes a `player_notes` update (or clears one), a team-wide roster-
 * construction policy becomes a `team_strategy_notes` entry that every other agent
 * reads on its next run. This is what makes the chat more than a Q&A toy — it's a real
 * input channel into how the other agents reason.
 */
export async function runChatTurn(
  db: SupabaseClient,
  userId: string,
  message: string,
): Promise<Result<{ reply: string; sources: ResearchSource[] }>> {
  const contextResult = await loadLeagueRosterContext(db, userId);
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

  const weekResult = await getCurrentFantasyWeek();
  const week = weekResult.ok ? weekResult.data : null;

  // Already-computed waiver/news recommendations (free — just a DB read, no extra LLM
  // or Perplexity cost) so the chat knows what's on the waiver wire and what's
  // newsworthy right now, not just the roster itself.
  let waiverQuery = db
    .from("recommendations")
    .select("title, reasoning, payload")
    .eq("league_id", ctx.leagueId)
    .eq("category", "waiver")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(RECOMMENDATION_CONTEXT_LIMIT);
  if (week !== null) waiverQuery = waiverQuery.eq("week", week);
  let newsQuery = db
    .from("recommendations")
    .select("title, reasoning, payload")
    .eq("league_id", ctx.leagueId)
    .eq("category", "news")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(RECOMMENDATION_CONTEXT_LIMIT);
  if (week !== null) newsQuery = newsQuery.eq("week", week);

  const [waiverRowsResult, newsRowsResult] = await Promise.all([waiverQuery, newsQuery]);

  const waiverSummary = (waiverRowsResult.data ?? [])
    .map((r) => {
      const p = r.payload as Record<string, unknown>;
      const add = p.addPlayer as string | undefined;
      const drop = p.dropCandidate as string | undefined;
      const action = add ? ` (Add ${add}${drop ? `, drop ${drop}` : ""})` : "";
      return `${r.title}${action}: ${r.reasoning}`;
    })
    .join("\n");
  const newsSummary = (newsRowsResult.data ?? [])
    .map((r) => `${r.title}: ${r.reasoning}`)
    .join("\n");

  // Live, question-specific research — same Perplexity search grounding every other
  // agent uses, but run fresh against the user's ACTUAL message so the chat can answer
  // like a direct Perplexity query, not just recite pre-computed cron output.
  // Best-effort: degrades to the pre-computed context above if unset/unavailable.
  const researchResult = await research(
    `Fantasy football question from a manager in a Superflex/2QB league: "${message}". ` +
      `Their roster: ${ctx.ownRosterPlayers.map((p) => p.fullName).join(", ")}. Give ` +
      `current, specific, real information relevant to answering this — recent news, ` +
      `depth chart/role, matchup context, or waiver-wire opinion, whichever applies.` +
      PREFERRED_SOURCES_NOTE,
  );
  if (!researchResult.ok) {
    console.warn("[chat] Perplexity research degraded:", researchResult.error);
  }
  const liveResearchContext = researchResult.ok
    ? `\n\nLive research on the user's current question (prefer this over your own ` +
      `general knowledge, since it's current):\n${researchResult.data.answer}`
    : "";
  const sources = researchResult.ok ? researchResult.data.sources : [];

  const { data: historyRows } = await db
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);
  const history = (historyRows ?? []).reverse();
  const historyText = history
    .map((h) => `${h.role === "user" ? "User" : "You"}: ${h.content}`)
    .join("\n");

  const rosterSummary = ctx.ownRosterPlayers
    .map(
      (p) =>
        `${p.fullName} — ${p.position ?? "?"} ${p.team ?? "FA"} — ${
          p.isStarter ? "STARTER" : "bench"
        }${p.status ? ` — status: ${p.status}` : ""}`,
    )
    .join("\n");

  const notesLines = ctx.ownRosterPlayers
    .map((p) => {
      const note = ctx.playerNotes.get(p.sleeperPlayerId);
      return note ? `${p.fullName}: "${note}"` : null;
    })
    .filter((line): line is string => !!line);
  const notesSummary =
    notesLines.length > 0 ? `\n\nExisting per-player notes:\n${notesLines.join("\n")}` : "";

  const watchlistSummary =
    ctx.watchlist.length > 0
      ? `\n\nWatchlist:\n${ctx.watchlist
          .map(
            (w) =>
              `${w.fullName} (${w.position ?? "?"} ${w.team ?? "FA"})${w.note ? ` — "${w.note}"` : ""}`,
          )
          .join("\n")}`
      : "";

  const llmResult = await generateJSON({
    system:
      "You are the user's fantasy football copilot for their Superflex/2QB league. " +
      "Answer questions and take directives about their team conversationally, " +
      "grounded in the real roster/notes/watchlist, this week's already-computed " +
      "waiver-wire and news recommendations, and the live research given below — " +
      "never invent players or claim a specific depth-chart fact you weren't given. " +
      "The live research is a real web search run specifically for this message, so " +
      "prefer it over your own general knowledge for anything current (news, rankings, " +
      "waiver opinions) — this is what makes you actually useful for 'who should I " +
      "add', 'what's the news on X', or 'who should I start' questions, not just a " +
      "roster Q&A. If asked why to keep or drop a player, give a real, specific reason " +
      "tied to their actual roster construction (position depth, bye weeks, injury " +
      "status, Superflex QB value) or the research provided, not a generic platitude.\n\n" +
      "When the user states a preference about ONE SPECIFIC player (e.g. 'I'm OK " +
      "trading Andrews', 'drop Fields', 'I'm on the fence about Merritt unless you " +
      "give me a good reason to keep him'), record it via playerNoteUpdates — the " +
      "`player` field MUST exactly match a name from the roster list given. Use an " +
      "EMPTY STRING note to clear an existing note when the user reverses a prior " +
      "stance. If the user asks a question rather than stating a preference, don't " +
      "force a note update just to have one.\n\n" +
      "When the user states a TEAM-WIDE roster-construction policy not tied to one " +
      "player (e.g. 'I only want to keep 2 QBs'), record it via teamStrategyNote as " +
      "ONE clear, standalone sentence — it gets shown to other agents out of context, " +
      "so it must be self-contained, not a fragment referring back to this " +
      "conversation.",
    prompt:
      `My roster:\n${rosterSummary}` +
      notesSummary +
      buildTeamStrategySummary(ctx.teamStrategyNotes) +
      watchlistSummary +
      (waiverSummary ? `\n\nThis week's waiver-wire recommendations:\n${waiverSummary}` : "") +
      (newsSummary ? `\n\nThis week's news items:\n${newsSummary}` : "") +
      liveResearchContext +
      (historyText ? `\n\nRecent conversation:\n${historyText}` : "") +
      `\n\nUser's new message: ${message}\n\n` +
      `Return JSON: { "reply": string, "playerNoteUpdates": [{ "player": string, ` +
      `"note": string }] (optional), "teamStrategyNote": string (optional) }.`,
    schema: ChatOutputSchema,
  });

  if (!llmResult.ok) return llmResult;

  // Both rows MUST list the same keys: Supabase's bulk insert treats a key present on
  // one row but absent on another as an explicit NULL for the row missing it (not "use
  // the column default") — the user row was tripping chat_messages.sources' not-null
  // constraint until `sources: []` was added here.
  const { error: insertError } = await db.from("chat_messages").insert([
    { user_id: userId, role: "user", content: message, sources: [] },
    { user_id: userId, role: "assistant", content: llmResult.data.reply, sources },
  ]);
  if (insertError) {
    return { ok: false, error: `Failed to save chat message: ${insertError.message}` };
  }

  const rosterNames = ctx.ownRosterPlayers.map((p) => p.fullName);
  for (const update of llmResult.data.playerNoteUpdates ?? []) {
    const matchedName = fuzzyMatchName(update.player, rosterNames);
    const player = matchedName
      ? ctx.ownRosterPlayers.find((p) => p.fullName === matchedName)
      : undefined;
    if (!player) {
      console.warn(`[chat] playerNoteUpdate "${update.player}" didn't match any roster player — skipped`);
      continue;
    }
    if (update.note.trim().length === 0) {
      await db
        .from("player_notes")
        .delete()
        .eq("user_id", userId)
        .eq("sleeper_player_id", player.sleeperPlayerId);
    } else {
      await db.from("player_notes").upsert(
        { user_id: userId, sleeper_player_id: player.sleeperPlayerId, note: update.note.trim() },
        { onConflict: "user_id,sleeper_player_id" },
      );
    }
  }

  if (llmResult.data.teamStrategyNote) {
    await db
      .from("team_strategy_notes")
      .insert({ user_id: userId, note: llmResult.data.teamStrategyNote });
  }

  return { ok: true, data: { reply: llmResult.data.reply, sources } };
}
