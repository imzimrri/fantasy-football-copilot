import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runTradeEvaluation } from "@/lib/agents/trade-evaluation";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runTradeEvaluation();
  if (!result.ok) {
    console.error("[cron/trade-evaluation]", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    summary: `Evaluated ${result.data.recommendationCount} pending trade(s)`,
  });
}
