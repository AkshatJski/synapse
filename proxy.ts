import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Synapse's network boundary.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`, and the runtime is
 * always Node.js (no edge). This is where the Supabase session is refreshed and
 * where protected routes are gated.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, so we never pay for a Supabase round trip
     * on a favicon request.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
