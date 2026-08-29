"use server";

import { revalidatePath } from "next/cache";
import { syncLeague } from "@/lib/sleeper-sync";

/**
 * Manual "hard refresh" — pulls the latest roster/matchup/transaction state straight
 * from Sleeper, the same sync the cron job runs daily. For when the user just made a
 * real move in the Sleeper app and doesn't want to wait for the next scheduled sync to
 * see it reflected here. Runs the exact same `syncLeague()` the cron route calls, just
 * invoked directly instead of over HTTP — no need for the CRON_SECRET dance since this
 * only runs from a Server Action embedded in an already-authenticated page.
 *
 * A real move also gets auto-matched against pending waiver recommendations during
 * sync (see `findMatchingWaiverRecommendation` in `lib/waiver-moves.ts`) — so
 * refreshing after executing a suggested add/drop also clears it off the pending
 * waiver list, not just updates the roster.
 */
export async function refreshFromSleeper() {
  const result = await syncLeague();
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath("/");
  revalidatePath("/roster");
  revalidatePath("/waivers");
  revalidatePath("/moves");
  revalidatePath("/trades");
  revalidatePath("/schedule");
  revalidatePath("/history");

  return {
    ok: true as const,
    summary:
      `Synced ${result.data.rosterCount} rosters, ${result.data.matchupCount} matchups, ` +
      `${result.data.tradeCount} trades, ${result.data.moveCount} waiver/FA moves`,
    warnings: result.data.warnings,
  };
}
