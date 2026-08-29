"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runChatTurn } from "@/lib/chat";

/**
 * One chat turn — runs under the logged-in user's session (RLS-scoped), grounded in
 * their real roster via `runChatTurn`. Revalidates every page whose recommendations
 * could be affected by a directive the chat just persisted (a new player note or team
 * strategy note), so the next agent-run's output — and any already-rendered page the
 * user navigates back to — reflects it without a manual refresh.
 */
export async function sendChatMessage(message: string) {
  const trimmed = message.trim();
  if (trimmed.length === 0) return { ok: false as const, error: "Message is empty" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) return { ok: false as const, error: "Not signed in" };

  const result = await runChatTurn(supabase, userId, trimmed);
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath("/chat");
  revalidatePath("/roster");
  revalidatePath("/waivers");
  revalidatePath("/trades");
  revalidatePath("/");

  return { ok: true as const, reply: result.data.reply };
}

/**
 * Clears conversation history only — `chat_messages` is short-term/working memory
 * (the last ~20 turns, used purely so the chat reads coherently across messages).
 * The actual decisions the chat has made (`player_notes`, `team_strategy_notes`) are
 * long-term memory: they're separate tables, untouched here, and keep shaping every
 * agent's recommendations regardless of whether the chat transcript exists.
 */
export async function clearChat() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) return { ok: false as const, error: "Not signed in" };

  const { error } = await supabase.from("chat_messages").delete().eq("user_id", userId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/chat");
  return { ok: true as const };
}
