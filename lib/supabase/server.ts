import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabaseEnv } from "@/lib/env";

/**
 * Server-side Supabase client for Server Components, Route Handlers and Server
 * Actions.
 *
 * Must be created per request — never cached across requests, or one user's
 * session leaks into another's render.
 *
 * `setAll` can throw inside a Server Component (cookies are read-only there).
 * That is expected: `proxy.ts` refreshes the session before rendering, so the
 * only thing a failed write here can cost us is a redundant refresh.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — safe to ignore, see docblock.
        }
      },
    },
  });
}
