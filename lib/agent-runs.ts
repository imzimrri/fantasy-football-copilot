import { createServiceClient, getAppUserId } from "@/lib/supabase/service";
import type { Result } from "@/lib/sleeper";

export type AgentName =
  | "sync-league"
  | "roster-analysis"
  | "waiver-research"
  | "trade-evaluation"
  | "trade-suggestions"
  | "news-monitoring";

/**
 * Runs an agent and records the outcome in `agent_runs`, so a failure is visible on
 * the dashboard instead of only in Vercel logs. Recording is best-effort — a failed
 * insert never changes the agent's own result.
 */
export async function recordAgentRun<T>(
  agent: AgentName,
  run: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const startedAt = new Date().toISOString();
  const result = await run();

  try {
    const db = createServiceClient();
    await db.from("agent_runs").insert({
      user_id: getAppUserId(),
      agent,
      status: result.ok ? "ok" : "error",
      summary: result.ok ? JSON.stringify(result.data).slice(0, 500) : null,
      error: result.ok ? null : result.error.slice(0, 1000),
      started_at: startedAt,
    });
  } catch (e) {
    console.warn(`[agent-runs] failed to record ${agent} run:`, e);
  }

  return result;
}
