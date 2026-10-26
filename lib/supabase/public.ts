import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseEnv } from "@/lib/env";

/**
 * Cookie-free Supabase client for content that is public by design.
 *
 * The share page must behave identically for a visitor with no session and for
 * a signed-in user opening someone else's link. Using the cookie-aware server
 * client would (a) pull `cookies()` into the render, and (b) make a logged-in
 * visitor authenticate as *their* role, which is not what decides access here —
 * the `share_slug` policy is.
 *
 * Never use this for anything user-scoped: there is no session, so every query
 * runs as `anon` and RLS must allow it explicitly.
 */
export function createPublicClient() {
  const { url, anonKey } = requireSupabaseEnv();

  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
