import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { recordAgentRun } from "@/lib/agent-runs";
import { runWaiverResearch } from "@/lib/agents/waiver-research";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await recordAgentRun("waiver-research", runWaiverResearch);
  if (!result.ok) {
    console.error("[cron/waiver-research]", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    summary: `Generated ${result.data.recommendationCount} waiver recommendations`,
  });
}
