import { DatabaseZap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  "Create a free project at supabase.com",
  "Copy .env.example to .env.local and paste your project URL + anon key",
  "Run supabase/migrations/0001_init.sql in the SQL editor",
  "Enable GitHub as an auth provider (optional — email works out of the box)",
  "Restart the dev server",
];

/** Shown instead of a crash when env vars are missing. */
export function SetupNotice() {
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseZap className="size-4 text-amber-500" />
          Connect Supabase to finish setup
        </CardTitle>
        <CardDescription>
          Synapse stores papers, projects and steps in Postgres with Row Level Security. It needs two
          public keys before it can save anything.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          The SQL file is at{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            supabase/migrations/0001_init.sql
          </code>
          .
        </p>
      </CardContent>
    </Card>
  );
}
