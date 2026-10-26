import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, LayoutGrid } from "lucide-react";

import { SetupNotice } from "@/components/setup-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/env";
import { DOMAINS } from "@/lib/roadmap";
import { isMissingGalleryColumn } from "@/lib/sharing";
import { createPublicClient } from "@/lib/supabase/public";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Browse Synapse roadmaps that their owners chose to publish. Every card links to a read-only page; nothing is listed unless it was shared and opted in.",
};

type GalleryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type GalleryRow = {
  title: string;
  domain: string;
  language: string;
  skill_level: string;
  share_slug: string | null;
  created_at: string;
  steps: { id: string }[] | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default function GalleryPage({ searchParams }: GalleryPageProps) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayoutGrid className="size-4" />
          Public gallery
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Roadmaps people chose to publish</h1>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
          Sharing a link already makes a roadmap readable by anyone who has it. Listing it here is
          a second, separate opt-in — the owner can remove it at any time, and their name is never
          shown.
        </p>
      </div>

      <Suspense fallback={<GallerySkeleton />}>
        <GalleryResults searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * Awaits `searchParams` and reads the anon client, so it sits behind Suspense:
 * the shell is static and the results stream in.
 */
async function GalleryResults({ searchParams }: Pick<GalleryPageProps, "searchParams">) {
  await connection();

  if (!isSupabaseConfigured()) return <SetupNotice />;

  const params = await searchParams;
  const requested = Array.isArray(params.domain) ? params.domain[0] : params.domain;
  const activeDomain = requested && DOMAINS.includes(requested as (typeof DOMAINS)[number]) ? requested : null;

  const supabase = createPublicClient();

  // RLS already limits anonymous reads to shared rows (`projects: read shared`).
  // `gallery_listed` is a filter over that same set, so a bug here cannot expose
  // a private roadmap — the database would refuse it.
  const baseQuery = supabase
    .from("projects")
    .select("title, domain, language, skill_level, share_slug, created_at, steps(id)")
    .eq("gallery_listed", true)
    .not("share_slug", "is", null)
    .order("created_at", { ascending: false })
    .limit(24);

  const { data, error } = await (activeDomain ? baseQuery.eq("domain", activeDomain) : baseQuery);

  if (error) {
    if (isMissingGalleryColumn(error)) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The gallery is not switched on yet</CardTitle>
            <CardDescription>
              Run{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                supabase/migrations/0003_gallery.sql
              </code>{" "}
              in the Supabase SQL editor, then reload this page. Sharing links keep working without
              it.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    console.error("[gallery] query failed", error);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Could not load the gallery</CardTitle>
          <CardDescription>
            The public database is not answering right now. Try reloading in a moment.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = ((data ?? []) as GalleryRow[]).filter((row) => row.share_slug);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2" role="navigation" aria-label="Filter by domain">
        <FilterChip href="/gallery" label="All" active={!activeDomain} />
        {DOMAINS.map((domain) => (
          <FilterChip
            key={domain}
            href={`/gallery?domain=${encodeURIComponent(domain)}`}
            label={domain}
            active={activeDomain === domain}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {activeDomain ? `Nothing in ${activeDomain} yet` : "Nothing listed yet"}
            </CardTitle>
            <CardDescription>
              {activeDomain ? (
                <>
                  Try{" "}
                  <Link href="/gallery" className="underline underline-offset-4">
                    all domains
                  </Link>
                  , or be the first to publish one here.
                </>
              ) : (
                "The gallery only shows roadmaps whose owners ticked the listing box. Generate a roadmap, share it, then list it."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard" />}>
              Generate a roadmap
              <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => {
            const created = new Date(row.created_at);
            const stepCount = row.steps?.length ?? 0;

            return (
              <li key={row.share_slug}>
                <Link
                  href={`/p/${row.share_slug}`}
                  className="group block h-full rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex h-full flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{row.domain}</Badge>
                      <Badge variant="outline">{row.language}</Badge>
                      <Badge variant="outline" className="capitalize">
                        {row.skill_level}
                      </Badge>
                    </div>

                    <h2 className="text-base font-medium leading-snug text-balance group-hover:underline group-hover:underline-offset-4">
                      {row.title}
                    </h2>

                    <p className="mt-auto text-xs text-muted-foreground">
                      {stepCount} {stepCount === 1 ? "step" : "steps"}
                      {!Number.isNaN(created.getTime()) && ` · ${dateFormatter.format(created)}`}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      }
    >
      {label}
    </Link>
  );
}

function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-6 w-20 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-xl border p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
