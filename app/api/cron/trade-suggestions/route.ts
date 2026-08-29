import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runTradeSuggestions } from "@/lib/agents/trade-suggestions";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runTradeSuggestions();
  if (!result.ok) {
    console.error("[cron/trade-suggestions]", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    summary:
      result.data.recommendationCount > 0
        ? "Found a trade idea worth considering"
        : "No compelling trade idea found right now",
  });
}
