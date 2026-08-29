import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runNewsMonitoring } from "@/lib/agents/news-monitoring";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNewsMonitoring();
  if (!result.ok) {
    console.error("[cron/news-monitoring]", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    summary: `Found ${result.data.recommendationCount} newsworthy item(s)`,
  });
}
