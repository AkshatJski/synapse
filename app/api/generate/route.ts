import { NextResponse } from "next/server";
import { z } from "zod";

import { ArxivError, isTransientArxivError, searchArxivPapers, type ArxivPaper } from "@/lib/arxiv";
import { isSupabaseConfigured } from "@/lib/env";
import type { GenerateEvent } from "@/lib/generate-events";
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

type Send = (event: GenerateEvent) => void;

/**
 * Turns a pipeline function into a streamed NDJSON response.
 *
 * Everything that can be rejected up front — bad body, signed out, quota — still
 * answers with a real status code and a JSON body, because the client needs to
 * branch on `response.ok` (401 means "go to /login"). Only the work that takes
 * time is streamed, and failures inside it arrive as `error` events carrying the
 * status they would have had.
 */
function streamPipeline(run: (send: Send) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The reader went away (tab closed, navigation). Stop pretending.
          closed = true;
        }
      };

      try {
        await run(send);
      } catch (error) {
        // A throw here means a bug, not an expected provider/DB failure. Still
        // emit an event so the UI cannot hang on a spinner forever.
        console.error("[generate] pipeline threw", error);
        send({
          type: "error",
          status: 500,
          message: "Something went wrong while generating. Please try again.",
          code: "INTERNAL",
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Progress must never be cached, and a proxy that recompresses it would
      // undo the point of streaming.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
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

  // ------------------------------------------------ 2. streamed pipeline
  return streamPipeline(async (send) => {
    const streamFail = (status: number, message: string, code: string) =>
      send({ type: "error", status, message, code });

    // ------------------------------------------------------------ 2a. arXiv
    let papers: ArxivPaper[] = [];
    const arxivStartedAt = Date.now();
    send({ type: "stage", stage: "searching" });

    try {
      papers = await searchArxivPapers(`${domain} ${language}`, 8);
      if (papers.length === 0) {
        // Second chance with a narrower query: the language term may have filtered
        // out every relevant paper.
        papers = await searchArxivPapers(domain, 8, { sortBy: "submittedDate" });
      }
    } catch (error) {
      const elapsedMs = Date.now() - arxivStartedAt;

      if (error instanceof ArxivError) {
        // This log line is the whole point: without it an outage produces a vague
        // message for the user and nothing at all for whoever debugs it.
        console.error("[generate] arxiv failed", {
          code: error.code,
          status: error.status,
          elapsedMs,
          query: `${domain} ${language}`,
        });

        if (error.code === "RATE_LIMITED") {
          streamFail(
            503,
            error.status === 429
              ? "arXiv is rate-limiting requests right now. Wait about a minute, then try again."
              : "arXiv is temporarily unavailable. Wait a minute, then try again.",
            error.code,
          );
          return;
        }

        streamFail(
          isTransientArxivError(error) ? 503 : 400,
          isTransientArxivError(error)
            ? "The paper library (arXiv) is not responding right now. Please try again in a moment."
            : "That search could not be run against arXiv. Try a broader domain.",
          error.code,
        );
        return;
      }

      console.error("[generate] arxiv threw a non-ArxivError", { elapsedMs, error });
      streamFail(502, "Could not reach arXiv.", "ARXIV_FAILED");
      return;
    }

    const paper = pickPaper(papers);
    if (!paper) {
      streamFail(
        404,
        "No arXiv paper matched that combination. Try a broader domain such as “Computer Vision”.",
        "NO_PAPER",
      );
      return;
    }

    // Reporting the paper the moment it is chosen is the useful half of "reading":
    // the wait after this point is the LLM, and the user can already see what the
    // roadmap will be about.
    send({
      type: "stage",
      stage: "reading",
      paper: { arxivId: paper.arxivId, title: paper.title },
    });

    // -------------------------------------------------------- 2b. cache paper
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
      streamFail(500, "Could not save the paper metadata. Please try again.", "DB_ERROR");
      return;
    }

    // ---------------------------------------------------------------- 2c. LLM
    send({ type: "stage", stage: "planning" });

    let roadmap;
    try {
      roadmap = await generateRoadmap({ paper, domain, language, skillLevel });
    } catch (error) {
      if (error instanceof LlmError) {
        switch (error.code) {
          case "NO_PROVIDER":
            streamFail(
              503,
              "No AI provider is configured. Add GROQ_API_KEY or GEMINI_API_KEY to .env.local.",
              "NO_PROVIDER",
            );
            return;
          case "RATE_LIMITED":
            streamFail(
              429,
              "The AI provider is busy right now. Please try again in a minute.",
              "LLM_RATE_LIMITED",
            );
            return;
          default:
            console.error("[generate] llm failed", error);
            streamFail(
              502,
              "The roadmap generator returned something unusable. Please try again.",
              error.code,
            );
            return;
        }
      }
      console.error("[generate] llm unexpected", error);
      streamFail(502, "The roadmap generator failed. Please try again.", "LLM_FAILED");
      return;
    }

    // ------------------------------------------------------------ 2d. persist
    send({ type: "stage", stage: "saving" });

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
      streamFail(500, "Could not save the project. Please try again.", "DB_ERROR");
      return;
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
      streamFail(500, "Could not save the roadmap steps. Please try again.", "DB_ERROR");
      return;
    }

    send({ type: "done", projectId: project.id });
  });
}
