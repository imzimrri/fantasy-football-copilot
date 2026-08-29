"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { RecommendationStatus } from "@/lib/types";

/**
 * FR23: mark a past recommendation as followed/not followed/dismissed. Runs under the
 * logged-in user's session — RLS (auth.uid() = user_id) is what actually scopes this,
 * not application logic, so there's no separate ownership check needed here.
 */
export async function markRecommendationStatus(
  id: string,
  status: RecommendationStatus,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("recommendations")
    .update({ status })
    .eq("id", id);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  revalidatePath("/history");
  return { ok: true as const };
}
