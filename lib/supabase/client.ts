"use client";

import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Browser Supabase client.
 *
 * The anon key is public by design — Row Level Security is what protects data.
 * Create it once per browser session; `createBrowserClient` already memoises the
 * underlying instance, so calling this from several components is fine.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
