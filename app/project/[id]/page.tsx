import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, BookOpen, ExternalLink, FlaskConical, Globe, RefreshCw } from "lucide-react";

import { MarkdownContent } from "@/components/markdown";
import { ProjectActions } from "@/components/project-actions";
import { RoadmapActions } from "@/components/roadmap-actions";
import { SetupNotice } from "@/components/setup-notice";
import { SharePanel } from "@/components/share-panel";
import { StepsList } from "@/components/steps-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSupabaseConfigured } from "@/lib/env";
import { isMissingSharingColumn } from "@/lib/sharing";
import { createClient } from "@/lib/supabase/server";
import type { PaperRow, ProjectRow, StepRow } from "@/lib/types";

type ProjectPageProps = { params: Promise<{ id: string }> };

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const metadata = { title: "Roadmap" };

export default function ProjectPage({ params }: ProjectPageProps) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <Button
        variant="ghost"
        size="sm"
        className="self-start print:hidden"
        render={<Link href="/dashboard" />}
      >
        <ArrowLeft className="size-4" />
        All roadmaps
      </Button>

      <Suspense fallback={<ProjectSkeleton />}>
        <ProjectContent params={params} />
      </Suspense>
    </main>
  );
}

/** Awaits `params` and reads the session, so it sits behind Suspense. */
async function ProjectContent({ params }: ProjectPageProps) {
  // Same reason as SiteHeader: Supabase's auth client calls Date.now() while
  // loading the session cookie, which cannot happen during prerender (BUG-014).
  await connection();

  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=/project/${id}`);

  const baseColumns =
    "id, user_id, paper_id, domain, language, skill_level, title, overview, eli5_summary, prerequisite_concepts, created_at";

  let { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select(`${baseColumns}, share_slug, shared_at, papers(*)`)
    .eq("id", id)
    .maybeSingle();

  // The share columns only exist after 0002_sharing.sql. Falling back keeps every
  // existing roadmap usable instead of turning the page into a 404 because a
  // migration has not been run yet.
  let sharingReady = true;
  if (projectError && isMissingSharingColumn(projectError)) {
    sharingReady = false;
    ({ data: projectData, error: projectError } = await supabase
      .from("projects")
      .select(`${baseColumns}, papers(*)`)
      .eq("id", id)
      .maybeSingle());
  }

  if (projectError) {
    console.error("[project] query failed", projectError);
  }
  if (!projectData) notFound();

  const project = projectData as unknown as ProjectRow & { papers: PaperRow | null };

  // Resolve the absolute origin on the server: the share panel must not guess it
  // from `window`, which would render differently on the server and the client.
  const requestHeaders = await headers();
  const origin = `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${
    requestHeaders.get("host") ?? "localhost:3000"
  }`;

  const { data: stepsData } = await supabase
    .from("steps")
    .select("*")
    .eq("project_id", id)
    .order("order_index", { ascending: true });

  const steps = (stepsData ?? []) as StepRow[];
  const paper = project.papers;

  // Same topic, same stack, same level - only the paper changes (D41).
  const anotherPaperHref = `/dashboard?domain=${encodeURIComponent(
    project.domain,
  )}&language=${encodeURIComponent(project.language)}&skill=${encodeURIComponent(project.skill_level)}`;

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{project.domain}</Badge>
            <Badge variant="outline">{project.language}</Badge>
            <Badge variant="outline" className="capitalize">
              {project.skill_level}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {dateFormatter.format(new Date(project.created_at))}
            </span>
            {project.share_slug && (
              <Badge variant="outline" className="gap-1 text-[0.7rem]">
                <Globe className="size-3" />
                Public
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <RoadmapActions project={project} steps={steps} paper={paper} />
            <Button variant="outline" size="sm" render={<Link href={anotherPaperHref} />}>
              <RefreshCw className="size-3.5" />
              Try another paper
            </Button>
            <ProjectActions projectId={project.id} title={project.title} />
          </div>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-balance">{project.title}</h1>

        {paper && (
          <p className="text-sm text-muted-foreground">
            Based on{" "}
            <a
              href={paper.abs_url ?? `https://arxiv.org/abs/${paper.arxiv_id}`}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {paper.title}
            </a>
          </p>
        )}
      </header>

      <div className="print:hidden">
        <SharePanel
          projectId={project.id}
          initialSlug={project.share_slug ?? null}
          origin={origin}
          sharingReady={sharingReady}
        />
      </div>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FlaskConical className="size-4 text-muted-foreground" />
            The paper, explained simply
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MarkdownContent content={project.eli5_summary ?? project.overview} />
        </CardContent>
      </Card>

      <Tabs defaultValue="roadmap" className="flex flex-col gap-4">
        <TabsList className="print:hidden">
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="paper">Paper</TabsTrigger>
          <TabsTrigger value="concepts">Prerequisites</TabsTrigger>
        </TabsList>

        <TabsContent value="roadmap">
          <StepsList steps={steps} language={project.language} />
        </TabsContent>

        <TabsContent value="paper">
          {paper ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base leading-snug">{paper.title}</CardTitle>
                <CardDescription>
                  {paper.authors?.map((author) => author.name).join(", ")}
                  {paper.published_date
                    ? ` · ${dateFormatter.format(new Date(paper.published_date))}`
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <MarkdownContent content={paper.abstract} />

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-mono text-[0.7rem]">
                    arXiv:{paper.arxiv_id}
                    {paper.version ? paper.version : ""}
                  </Badge>
                  {paper.primary_category && (
                    <Badge variant="outline" className="font-mono text-[0.7rem]">
                      {paper.primary_category}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={paper.abs_url ?? "#"} target="_blank" rel="noreferrer noopener" />}
                  >
                    <ExternalLink className="size-3.5" />
                    Abstract page
                  </Button>
                  {paper.pdf_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={paper.pdf_url ?? "#"} target="_blank" rel="noreferrer noopener" />}
                    >
                      <BookOpen className="size-3.5" />
                      Read the PDF
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Paper metadata is unavailable.</p>
          )}
        </TabsContent>

        <TabsContent value="concepts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Know these before you start</CardTitle>
              <CardDescription>
                Each one is worth a 20-minute read. Skipping them makes the steps feel like magic
                tricks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {project.prerequisite_concepts.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {project.prerequisite_concepts.map((concept) => (
                    <li key={concept} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      {concept}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No prerequisites listed.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function ProjectSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-9 w-64" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
