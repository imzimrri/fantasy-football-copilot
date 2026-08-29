import { NextRequest } from "next/server";

/**
 * Verifies the request came from Vercel Cron (or a manual call carrying the same
 * secret) — used by every `app/api/cron/*` route so they can't be triggered publicly.
 * Vercel sends this automatically as `Authorization: Bearer $CRON_SECRET` for
 * cron-triggered requests when CRON_SECRET is set in the project's env vars.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if misconfigured
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
