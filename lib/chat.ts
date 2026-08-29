import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/llm";
import type { Result } from "@/lib/sleeper";
import { fuzzyMatchName } from "@/lib/fuzzy-match";
import { buildTeamStrategySummary, loadLeagueRosterContext } from "@/lib/agents/shared";

const CHAT_HISTORY_LIMIT = 20;

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
): Promise<Result<{ reply: string }>> {
  const contextResult = await loadLeagueRosterContext(db, userId);
  if (!contextResult.ok) return contextResult;
  const ctx = contextResult.data;

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
      "grounded ONLY in the real roster/notes/watchlist given below — never invent " +
      "players or claim a specific depth-chart fact you weren't given. If asked why " +
      "to keep or drop a player, give a real, specific reason tied to their actual " +
      "roster construction (position depth, bye weeks, injury status, Superflex QB " +
      "value), not a generic platitude.\n\n" +
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
      (historyText ? `\n\nRecent conversation:\n${historyText}` : "") +
      `\n\nUser's new message: ${message}\n\n` +
      `Return JSON: { "reply": string, "playerNoteUpdates": [{ "player": string, ` +
      `"note": string }] (optional), "teamStrategyNote": string (optional) }.`,
    schema: ChatOutputSchema,
  });

  if (!llmResult.ok) return llmResult;

  const { error: insertError } = await db.from("chat_messages").insert([
    { user_id: userId, role: "user", content: message },
    { user_id: userId, role: "assistant", content: llmResult.data.reply },
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

  return { ok: true, data: { reply: llmResult.data.reply } };
}
