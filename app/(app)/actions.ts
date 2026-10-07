"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncLeague } from "@/lib/sleeper-sync";
import { loadAgentContext } from "@/lib/agents/shared";
import { resolveStaleWaiverRecommendations } from "@/lib/waiver-moves";
import { recordAgentRun } from "@/lib/agent-runs";
import { runRosterAnalysis } from "@/lib/agents/roster-analysis";

/**
 * Manual "hard refresh" — pulls the latest roster/matchup/transaction state straight
 * from Sleeper, the same sync the cron job runs daily. For when the user just made a
 * real move in the Sleeper app and doesn't want to wait for the next scheduled sync to
 * see it reflected here. Runs the same `syncLeague()` the cron route calls, scoped to
 * the current week so it finishes in seconds, and invoked directly instead of over
 * HTTP — no need for the CRON_SECRET dance since this only runs from a Server Action
 * embedded in an already-authenticated page.
 *
 * A real move also gets auto-matched against pending waiver recommendations during
 * sync (see `findMatchingWaiverRecommendation` in `lib/waiver-moves.ts`) — so
 * refreshing after executing a suggested add/drop also clears it off the pending
 * waiver list, not just updates the roster.
 */
/**
 * Server Actions are public POST endpoints, and both actions here act on the app
 * owner's league with the service-role client (bypassing RLS) and spend API credits.
 * The proxy only proves *a* user is signed in — sign-up is open — so also require that
 * the signed-in user IS the app owner.
 */
async function isAppOwner(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  return !!userId && userId === process.env.FFC_USER_ID;
}

export async function refreshFromSleeper() {
  if (!(await isAppOwner())) return { ok: false as const, error: "Not authorized" };
  const result = await syncLeague({ scope: "current" });
  if (!result.ok) return { ok: false as const, error: result.error };

  // Best-effort: clear any pending waiver recommendation for a player who's now
  // actually on the roster (per the just-synced data), so a suggestion the user
  // already acted on doesn't keep sitting there until tomorrow's cron. Never fails
  // the refresh itself — a stale card lingering an extra day is a UI nuisance, not a
  // reason to report the sync as failed.
  const ctxResult = await loadAgentContext();
  if (ctxResult.ok) {
    await resolveStaleWaiverRecommendations(
      ctxResult.data.db,
      ctxResult.data.userId,
      ctxResult.data.leagueId,
      ctxResult.data.ownRosterPlayers.map((p) => p.fullName),
    );
  }

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

/**
 * Manual "Run analysis now" — re-runs the start/sit + matchup agent on demand. Crons
 * only fire once a day (Hobby plan), so without this a failed or stale run meant
 * waiting until tomorrow. Recorded in `agent_runs` like a cron run.
 */
export async function runAnalysisNow() {
  if (!(await isAppOwner())) return { ok: false as const, error: "Not authorized" };
  const result = await recordAgentRun("roster-analysis", runRosterAnalysis);
  revalidatePath("/");
  if (!result.ok) return { ok: false as const, error: result.error };
  return { ok: true as const };
}
