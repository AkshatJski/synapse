import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";

/** Routes that require a session. */
const PROTECTED_PREFIXES = ["/dashboard", "/project"];

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 *
 * Runs from `proxy.ts` (Next.js 16 renamed `middleware.ts` -> `proxy.ts`).
 * Doing the refresh here — before any rendering — is what makes
 * `createClient()` in Server Components able to rely on a valid token without
 * ever writing cookies itself.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No credentials configured yet: let the app render its setup screen instead
  // of crashing every request.
  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Mirror onto the request so downstream rendering sees the new values…
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        // …and onto the response so the browser stores them.
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Supabase supplies no-store cache headers for responses that set auth
        // cookies. Without them a CDN could serve one user's token to another.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Must be called before the response is generated: a refresh that lands after
  // the response is committed cannot write its cookies back.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const needsAuth = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (needsAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);

    const redirect = NextResponse.redirect(loginUrl);
    // Carry over any cookies Supabase just refreshed, otherwise the user is
    // bounced straight back out on the next request.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
