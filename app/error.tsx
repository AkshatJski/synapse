"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Segment error boundary. Without this file an unexpected throw renders a
 * blank page with no way back; the digest is the only handle that ties the
 * screen to a server log line.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] unhandled error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" />
            Something broke on this page
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The error was caught before it could take the whole app down. Your saved roadmaps are
            untouched. Try again, and if it keeps happening the server log has the details.
          </p>

          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" render={<Link href="/dashboard" />}>
              Back to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
