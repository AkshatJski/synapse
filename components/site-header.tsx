import Link from "next/link";
import { connection } from "next/server";
import { LayoutDashboard, LayoutGrid, Sparkles, User } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Async Server Component — it reads the session from cookies.
 *
 * Because Cache Components are enabled, it must be rendered inside a
 * <Suspense> boundary (see app/layout.tsx). That is what lets every page keep a
 * static shell while the per-user part streams in.
 */
export async function SiteHeader() {
  // Supabase's auth client calls Date.now() while loading the session from the
  // cookie. Next treats that as an unstable value, so prerendering must stop
  // *before* the client is constructed — otherwise every request logs
  // "encountered the unstable value Date.now() while prerendering" for
  // signed-in users (BUG-014).
  await connection();

  let displayName: string | null = null;

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    displayName =
      (user?.user_metadata?.user_name as string | undefined) ??
      (user?.user_metadata?.full_name as string | undefined) ??
      user?.email?.split("@")[0] ??
      null;
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4" />
          Synapse
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" render={<Link href="/gallery" />}>
            <LayoutGrid className="size-4" />
            Gallery
          </Button>
          {displayName ? (
            <>
              <Button variant="ghost" size="sm" render={<Link href="/dashboard" />}>
                <LayoutDashboard className="size-4" />
                Dashboard
              </Button>
              <span className="hidden items-center gap-1.5 px-2 text-muted-foreground sm:flex">
                <User className="size-3.5" />
                {displayName}
              </span>
              <form action={signOut}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button variant="ghost" size="sm" render={<Link href="/login" />}>
              Sign in
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Static stand-in shown while the session resolves. */
export function SiteHeaderFallback() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <span className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4" />
          Synapse
        </span>
        <span className="h-6 w-16 animate-pulse rounded bg-muted" />
      </div>
    </header>
  );
}
