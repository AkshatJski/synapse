import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight, BookOpen, FolderOpen } from "lucide-react";

import { GenerateForm } from "@/components/generate-form";
import { ProjectActions } from "@/components/project-actions";
import { SetupNotice } from "@/components/setup-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ProjectWithProgress } from "@/lib/types";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const metadata = {
  title: "Dashboard",
};

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function DashboardPage({ searchParams }: DashboardPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">
          Pick a domain, a language and your level, then choose the paper. Synapse writes the
          roadmap from there.
        </p>
      </div>

      {isSupabaseConfigured() ? (
        <Suspense fallback={<GenerateFormSkeleton />}>
          <FormSection searchParams={searchParams} />
        </Suspense>
      ) : (
        <SetupNotice />
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Your roadmaps</h2>
        <Suspense fallback={<ProjectsSkeleton />}>
          <ProjectsSection />
        </Suspense>
      </section>
    </main>
  );
}

/**
 * Awaits `searchParams`, so it lives behind the Suspense boundary above — the
 * static shell renders the skeleton while params resolve.
 *
 * This is how "Try another paper" on a project page arrives with its domain,
 * language and level already filled in.
 */
async function FormSection({ searchParams }: Pick<DashboardPageProps, "searchParams">) {
  const params = await searchParams;

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return (
    <GenerateForm
      initialDomain={first(params.domain)}
      initialLanguage={first(params.language)}
      initialSkill={first(params.skill)}
    />
  );
}

/**
 * Reads cookies(), so it lives behind the Suspense boundary above — that is the
 * Cache Components contract: static shell, streamed dynamic section.
 */
async function ProjectsSection() {
  // Same reason as SiteHeader: stop prerendering before Supabase's auth client
  // calls Date.now() while reading the session cookie (BUG-014).
  await connection();

  if (!isSupabaseConfigured()) {
    return (
      <p className="text-sm text-muted-foreground">
        Your saved projects will appear here once the database is connected.
      </p>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard");

  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, title, domain, language, skill_level, created_at, papers(id, arxiv_id, title, abs_url, pdf_url, primary_category, published_date), steps(is_completed)",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[dashboard] projects query failed", error);
    return (
      <p className="text-sm text-destructive">
        Could not load your projects. Check the server logs and confirm the migration ran.
      </p>
    );
  }

  const projects = (data ?? []) as unknown as ProjectWithProgress[];

  if (projects.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No roadmaps yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Generate your first one above — it takes about ten seconds and costs nothing.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {projects.map((project) => {
        const total = project.steps?.length ?? 0;
        const done = project.steps?.filter((step) => step.is_completed).length ?? 0;
        const percent = total === 0 ? 0 : Math.round((done / total) * 100);

        return (
          <Card key={project.id} className="flex flex-col">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{project.domain}</Badge>
                <Badge variant="outline">{project.language}</Badge>
                <Badge variant="outline" className="capitalize">
                  {project.skill_level}
                </Badge>
              </div>
              <CardTitle className="text-base leading-snug">{project.title}</CardTitle>
              <CardDescription className="line-clamp-2">
                {project.papers?.title ?? "Paper unavailable"}
              </CardDescription>
            </CardHeader>

            <CardContent className="mt-auto flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {done}/{total} steps · {percent}%
                </span>
                <span>{dateFormatter.format(new Date(project.created_at))}</span>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" render={<Link href={`/project/${project.id}`} />}>
                    Open roadmap
                    <ArrowRight className="size-3.5" />
                  </Button>
                  {project.papers?.abs_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      render={
                        <a href={project.papers.abs_url} target="_blank" rel="noreferrer noopener" />
                      }
                    >
                      <BookOpen className="size-3.5" />
                      Paper
                    </Button>
                  )}
                </div>

                <ProjectActions compact projectId={project.id} title={project.title} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function GenerateFormSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-5 h-9 w-36" />
      </CardContent>
    </Card>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1].map((index) => (
        <Card key={index}>
          <CardHeader>
            <div className="flex gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="mt-2 h-5 w-3/4" />
            <Skeleton className="mt-1 h-4 w-full" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-7 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
