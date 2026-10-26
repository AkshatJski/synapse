import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowUpRight, BookOpen, ExternalLink, Eye, FlaskConical, Sparkles } from "lucide-react";

import { MarkdownContent } from "@/components/markdown";
import { StepsList } from "@/components/steps-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSupabaseConfigured } from "@/lib/env";
import { isMissingSharingColumn } from "@/lib/sharing";
import { createPublicClient } from "@/lib/supabase/public";
import type { PaperRow, ProjectRow, StepRow } from "@/lib/types";

type SharePageProps = { params: Promise<{ slug: string }> };

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const FALLBACK_METADATA: Metadata = {
  title: "Shared roadmap",
  description: "A buildable project roadmap generated from an arXiv paper, built with Synapse.",
};

/**
 * The OG tags matter here more than anywhere else in the app: the whole point of
 * a share link is that it gets pasted into a chat. A link with no title renders
 * as a bare URL.
 */
export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  if (!isSupabaseConfigured()) return FALLBACK_METADATA;

  // Without this, the metadata query is started during the shell-prerender pass
  // and rejected when that pass finishes ("fetch() rejects when the prerender is
  // complete"), which made the first visitor to a fresh share link see the
  // not-found UI. connection() stops prerendering before the query starts
  // (BUG-015).
  await connection();

  const { slug } = await params;

  let project: { title: string; overview: string } | null = null;

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("projects")
      .select("title, overview")
      .eq("share_slug", slug)
      .maybeSingle<{ title: string; overview: string }>();

    if (error && !isMissingSharingColumn(error)) {
      console.error("[share] metadata lookup failed", error);
    }
    project = data ?? null;
  } catch (error) {
    console.error("[share] metadata lookup threw", error);
    return FALLBACK_METADATA;
  }

  // Metadata resolves before the static shell is flushed, which makes it the one
  // place where a missing/revoked slug can still produce a real 404 status
  // instead of a 200 that merely renders the not-found UI.
  if (!project) notFound();

  const description = project.overview.slice(0, 155);

  return {
    title: project.title,
    description,
    openGraph: {
      title: project.title,
      description,
      type: "article",
    },
    twitter: { card: "summary", title: project.title, description },
  };
}

export default function SharePage({ params }: SharePageProps) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Synapse
        </Link>

        <Button variant="outline" size="sm" render={<Link href="/dashboard" />}>
          Make your own
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>

      <Suspense fallback={<RoadmapSkeleton />}>
        <SharedRoadmap params={params} />
      </Suspense>
    </main>
  );
}

async function SharedRoadmap({ params }: SharePageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <p className="text-sm text-muted-foreground">
        This deployment is not connected to a database, so shared roadmaps cannot be loaded.
      </p>
    );
  }

  // Same reason as generateMetadata: the row lookup must not begin during the
  // prerender pass, or the first request after a deploy loses its data (BUG-015).
  await connection();

  const { slug } = await params;
  const supabase = createPublicClient();

  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select(
      "id, user_id, paper_id, domain, language, skill_level, title, overview, eli5_summary, prerequisite_concepts, created_at, share_slug, shared_at, papers(*)",
    )
    .eq("share_slug", slug)
    .maybeSingle();

  if (projectError && !isMissingSharingColumn(projectError)) {
    console.error("[share] query failed", projectError);
  }
  if (!projectData) notFound();

  const project = projectData as unknown as ProjectRow & { papers: PaperRow | null };

  const { data: stepsData } = await supabase
    .from("steps")
    .select("*")
    .eq("project_id", project.id)
    .order("order_index", { ascending: true });

  const steps = (stepsData ?? []) as StepRow[];
  const paper = project.papers;

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{project.domain}</Badge>
          <Badge variant="outline">{project.language}</Badge>
          <Badge variant="outline" className="capitalize">
            {project.skill_level}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {dateFormatter.format(new Date(project.created_at))}
          </span>
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

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="size-3.5" />
          Read-only copy. Progress tracking belongs to whoever created this roadmap.
        </p>
      </header>

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
        <TabsList>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="paper">Paper</TabsTrigger>
          <TabsTrigger value="concepts">Prerequisites</TabsTrigger>
        </TabsList>

        <TabsContent value="roadmap">
          <StepsList steps={steps} language={project.language} readOnly />
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

      <Card className="border-dashed bg-muted/30">
        <CardContent className="flex flex-col items-start gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Want a roadmap like this for another paper?</p>
            <p className="text-sm text-muted-foreground">
              Pick a domain, a language and a level. Synapse finds the paper and writes the plan.
            </p>
          </div>
          <Button size="sm" render={<Link href="/dashboard" />} className="shrink-0">
            <Sparkles className="size-4" />
            Generate one
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

function RoadmapSkeleton() {
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
