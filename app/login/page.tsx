"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GitBranch, Loader2, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Client-only on purpose: the whole page is one form with two auth paths.
 *
 * `?next=` and `?error=` are read from `window.location` inside an effect rather
 * than through `useSearchParams`, which keeps this route fully static — no
 * Suspense boundary, no server render cost.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  // Read the post-login destination during the initial render rather than in an
  // effect: it is only used to build a redirect URL, never rendered, so there is
  // no hydration risk. Guarded for the server pass.
  const [next] = useState(() => {
    if (typeof window === "undefined") return "/dashboard";
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  });
  const [pendingGithub, setPendingGithub] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(false);
  const [sent, setSent] = useState(false);

  const configured = isSupabaseConfigured();

  // Effects are for external systems: a toast is exactly that.
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) toast.error(decodeURIComponent(error));
  }, []);

  async function signInWithGithub() {
    if (!configured) {
      toast.error("Supabase is not configured yet — add your keys to .env.local.");
      return;
    }

    setPendingGithub(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setPendingGithub(false);
      toast.error(error.message);
    }
    // On success the browser is redirected, so the spinner stays on.
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();

    if (!configured) {
      toast.error("Supabase is not configured yet — add your keys to .env.local.");
      return;
    }
    if (!email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }

    setPendingEmail(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setPendingEmail(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setSent(true);
    toast.success("Check your inbox — the sign-in link is on its way.");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4" />
            Synapse
          </div>
          <CardTitle className="text-2xl">Sign in to build</CardTitle>
          <CardDescription>
            Your roadmaps are private. Sign in to save them and track progress.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {!configured && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              Supabase keys are missing. Copy <code className="font-mono">.env.example</code> to{" "}
              <code className="font-mono">.env.local</code>, add your project URL and anon key, then
              restart the dev server.
            </p>
          )}

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={signInWithGithub}
            disabled={pendingGithub || pendingEmail}
          >
            {pendingGithub ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GitBranch className="size-4" />
            )}
            Continue with GitHub
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pendingEmail || sent}
            />
            <Button type="submit" className="w-full" disabled={pendingEmail || sent}>
              {pendingEmail ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              {sent ? "Link sent" : "Email me a sign-in link"}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            By continuing you agree to keep your API keys out of git.{" "}
            <Link href="/" className="underline underline-offset-4 hover:text-foreground">
              Back home
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
