import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { syncLeague } from "@/lib/sleeper-sync";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncLeague();
  if (!result.ok) {
    console.error("[cron/sync-league]", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  if (result.data.warnings.length > 0) {
    console.warn("[cron/sync-league] warnings:", result.data.warnings);
  }

  return NextResponse.json({
    ok: true,
    summary: `Synced ${result.data.rosterCount} rosters, ${result.data.playerCount} players, ${result.data.matchupCount} matchups, ${result.data.tradeCount} trades, ${result.data.moveCount} waiver/FA moves`,
    warnings: result.data.warnings,
  });
}
