"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves (or clears, if empty) the user's own stated reasoning for holding a player —
 * agents are required to explicitly address this, not silently ignore it (see
 * lib/agents/waiver-research.ts and roster-analysis.ts). Runs under the logged-in
 * user's session — RLS scopes it, not application logic.
 */
export async function savePlayerNote(sleeperPlayerId: string, note: string) {
  const supabase = await createClient();
  const trimmed = note.trim();

  if (trimmed.length === 0) {
    const { error } = await supabase
      .from("player_notes")
      .delete()
      .eq("sleeper_player_id", sleeperPlayerId);
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/roster");
    revalidatePath("/");
    return { ok: true as const };
  }

  const { error } = await supabase
    .from("player_notes")
    .upsert(
      { sleeper_player_id: sleeperPlayerId, note: trimmed },
      { onConflict: "user_id,sleeper_player_id" },
    );

  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/roster");
  revalidatePath("/");
  return { ok: true as const };
}
