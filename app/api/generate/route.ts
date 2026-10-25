import { NextResponse } from "next/server";
import { z } from "zod";

import { ArxivError, isTransientArxivError, searchArxivPapers, type ArxivPaper } from "@/lib/arxiv";
import { isSupabaseConfigured } from "@/lib/env";
import { generateRoadmap, LlmError } from "@/lib/llm";
import { SKILL_LEVELS } from "@/lib/roadmap";
import { createClient } from "@/lib/supabase/server";
import type { PaperRow } from "@/lib/types";

/** Fluid Compute handles long requests, but keep the ceiling explicit. */
export const maxDuration = 60;

const DAILY_GENERATION_LIMIT = 10;

const BodySchema = z.object({
  domain: z.string().trim().min(2).max(80),
  language: z.string().trim().min(1).max(40),
  skillLevel: z.enum(SKILL_LEVELS),
});

/** JSON error with a message that is safe to show a user verbatim. */
function fail(status: number, message: string, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Relevance is what arXiv sorts by; recency is what a learner wants.
 * Keep the relevance order, but prefer papers from the last five years.
 */
function pickPaper(papers: ArxivPaper[]): ArxivPaper | null {
  if (papers.length === 0) return null;

  const cutoff = Date.now() - 5 * 365 * 24 * 60 * 60 * 1000;
  const recent = papers.find((paper) => {
    if (!paper.publishedDate) return false;
    return Date.parse(paper.publishedDate) >= cutoff;
  });

  return recent ?? papers[0];
}

export async function POST(request: Request) {
  // ---------------------------------------------------------------- 0. input
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Request body must be valid JSON.", "BAD_REQUEST");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "Pick a domain, a language and a valid skill level.", "BAD_REQUEST");
  }
  const { domain, language, skillLevel } = parsed.data;

  // ------------------------------------------------------------- 1. backend
  if (!isSupabaseConfigured()) {
    return fail(
      503,
      "Synapse is not connected to a database yet. Add your Supabase keys to .env.local and run the migration.",
      "NOT_CONFIGURED",
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail(401, "Please sign in to generate a project.", "UNAUTHENTICATED");
  }

  // Cheap abuse guard for a free-tier deployment: cap generations per user per day.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);

  if ((recentCount ?? 0) >= DAILY_GENERATION_LIMIT) {
    return fail(
      429,
      `You have generated ${DAILY_GENERATION_LIMIT} projects in the last 24 hours. Try again tomorrow.`,
      "QUOTA_EXCEEDED",
    );
  }

  // -------------------------------------------------------------- 2. arXiv
  let papers: ArxivPaper[] = [];
  try {
    papers = await searchArxivPapers(`${domain} ${language}`, 8);
    if (papers.length === 0) {
      // Second chance with a narrower query: the language term may have filtered
      // out every relevant paper.
      papers = await searchArxivPapers(domain, 8, { sortBy: "submittedDate" });
    }
  } catch (error) {
    if (error instanceof ArxivError) {
      const status = isTransientArxivError(error) ? 503 : 400;
      return fail(
        status,
        isTransientArxivError(error)
          ? "The paper library (arXiv) is not responding right now. Please try again in a moment."
          : "That search could not be run against arXiv. Try a broader domain.",
        error.code,
      );
    }
    return fail(502, "Could not reach arXiv.", "ARXIV_FAILED");
  }

  const paper = pickPaper(papers);
  if (!paper) {
    return fail(
      404,
      "No arXiv paper matched that combination. Try a broader domain such as “Computer Vision”.",
      "NO_PAPER",
    );
  }

  // ------------------------------------------------------------ 3. cache paper
  const paperPayload = {
    arxiv_id: paper.arxivId,
    version: paper.version,
    canonical_id: paper.canonicalId,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors,
    primary_category: paper.primaryCategory,
    categories: paper.categories,
    published_date: paper.publishedDate,
    abs_url: paper.absUrl,
    pdf_url: paper.pdfUrl,
    cached_at: new Date().toISOString(),
  };

  const { data: cachedPaper, error: paperError } = await supabase
    .from("papers")
    .upsert(paperPayload, { onConflict: "arxiv_id" })
    .select("id")
    .single<Pick<PaperRow, "id">>();

  if (paperError || !cachedPaper) {
    console.error("[generate] paper cache failed", paperError);
    return fail(500, "Could not save the paper metadata. Please try again.", "DB_ERROR");
  }

  // ---------------------------------------------------------------- 4. LLM
  let roadmap;
  try {
    roadmap = await generateRoadmap({ paper, domain, language, skillLevel });
  } catch (error) {
    if (error instanceof LlmError) {
      switch (error.code) {
        case "NO_PROVIDER":
          return fail(
            503,
            "No AI provider is configured. Add GROQ_API_KEY or GEMINI_API_KEY to .env.local.",
            "NO_PROVIDER",
          );
        case "RATE_LIMITED":
          return fail(
            429,
            "The AI provider is busy right now. Please try again in a minute.",
            "LLM_RATE_LIMITED",
          );
        default:
          console.error("[generate] llm failed", error);
          return fail(
            502,
            "The roadmap generator returned something unusable. Please try again.",
            error.code,
          );
      }
    }
    console.error("[generate] llm unexpected", error);
    return fail(502, "The roadmap generator failed. Please try again.", "LLM_FAILED");
  }

  // ------------------------------------------------------------- 5. persist
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      paper_id: cachedPaper.id,
      domain,
      language,
      skill_level: skillLevel,
      title: roadmap.projectTitle,
      overview: roadmap.paperSummaryELI5,
      eli5_summary: roadmap.paperSummaryELI5,
      prerequisite_concepts: roadmap.prerequisiteConcepts,
    })
    .select("id")
    .single<{ id: string }>();

  if (projectError || !project) {
    console.error("[generate] project insert failed", projectError);
    return fail(500, "Could not save the project. Please try again.", "DB_ERROR");
  }

  const { error: stepsError } = await supabase.from("steps").insert(
    roadmap.steps.map((step, index) => ({
      project_id: project.id,
      order_index: index,
      title: step.title,
      description: step.description,
      code_snippet: step.codeSnippet,
      estimated_time: step.estimatedTime,
    })),
  );

  if (stepsError) {
    console.error("[generate] steps insert failed", stepsError);
    // Roll back the orphaned project so the user never sees an empty roadmap.
    await supabase.from("projects").delete().eq("id", project.id);
    return fail(500, "Could not save the roadmap steps. Please try again.", "DB_ERROR");
  }

  return NextResponse.json(
    { projectId: project.id, paper: { arxivId: paper.arxivId, title: paper.title } },
    { status: 201 },
  );
}
