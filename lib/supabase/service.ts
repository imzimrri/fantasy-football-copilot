import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for cron/agent jobs — bypasses RLS entirely.
 * Never import this into client-side code or anything reachable from the browser.
 * Cron/agent writes must set `user_id` explicitly (see FFC_USER_ID in project_context.md
 * — there's no user session here for `auth.uid()` to resolve from).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for service client",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The single app user's UUID, required for every cron/agent write. */
export function getAppUserId(): string {
  const userId = process.env.FFC_USER_ID;
  if (!userId) {
    throw new Error(
      "FFC_USER_ID is not set — sign up once via /auth/sign-up, then copy the " +
        "resulting auth.users.id into FFC_USER_ID (see .env.example).",
    );
  }
  return userId;
}
