"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Free-agent-ish search: any fantasy-relevant player by name, for adding to the watchlist. */
export async function searchPlayers(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true as const, data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("players")
    .select("sleeper_player_id, full_name, position, team")
    .ilike("full_name", `%${trimmed}%`)
    .limit(10);

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, data: data ?? [] };
}

export async function addToWatchlist(sleeperPlayerId: string, note?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("watchlist_players").upsert(
    { sleeper_player_id: sleeperPlayerId, note: note?.trim() || null },
    { onConflict: "user_id,sleeper_player_id" },
  );
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/waivers");
  return { ok: true as const };
}

export async function removeFromWatchlist(sleeperPlayerId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("watchlist_players")
    .delete()
    .eq("sleeper_player_id", sleeperPlayerId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/waivers");
  return { ok: true as const };
}

export async function updateWatchlistNote(sleeperPlayerId: string, note: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("watchlist_players")
    .update({ note: note.trim() || null })
    .eq("sleeper_player_id", sleeperPlayerId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/waivers");
  return { ok: true as const };
}
