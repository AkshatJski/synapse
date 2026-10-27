import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ArxivError,
  getArxivPaper,
  isTransientArxivError,
  type ArxivPaper,
} from "@/lib/arxiv";
import { isSupabaseConfigured } from "@/lib/env";
import type { GenerateEvent } from "@/lib/generate-events";
import { generateRoadmap, LlmError } from "@/lib/llm";
import { getArxivPaperByOpenAlex, searchRecentArxiv } from "@/lib/openalex";
import { DOMAINS, LANGUAGES, SKILL_LEVELS } from "@/lib/roadmap";
import { logEvent } from "@/lib/events";
import { generateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { PaperRow } from "@/lib/types";

/** Fluid Compute handles long requests, but keep the ceiling explicit. */
export const maxDuration = 60;

const DAILY_GENERATION_LIMIT = 10;

const BodySchema = z.object({
  // Enums, not free text: the UI only offers these, and it bounds how many
  // distinct arXiv queries the API can be made to issue.
  domain: z.enum(DOMAINS),
  language: z.enum(LANGUAGES),
  skillLevel: z.enum(SKILL_LEVELS),
  /** Present when the user picked a paper; absent means "surprise me". */
  paperId: z.string().trim().min(1).max(32).optional(),
});

/** JSON error with a message that is safe to show a user verbatim. */
function fail(status: number, message: string, code: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: message, code }, { status, headers });
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
 * Relevance is what the paper index sorts by; recency is what a learner wants.
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
  const { domain, language, skillLevel, paperId } = parsed.data;

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

  // Best-effort per-instance speed bump in front of the expensive path (D44).
  const limit = generateLimiter.check(user.id);
  if (!limit.ok) {
    return fail(
      429,
      "You are generating too quickly. Wait a few seconds and try again.",
      "RATE_LIMITED",
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
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
    const pipelineStartedAt = Date.now();
    const streamFail = (status: number, message: string, code: string) =>
      send({ type: "error", status, message, code });

    logEvent("generate_started", {
      chosen: Boolean(paperId),
      domain,
      language,
      skillLevel,
    });

    // ------------------------------------------------------------ 2a. paper
    // Two ways in: an id from the picker (D41), or a fresh search ("surprise me").
    let paper: ArxivPaper;
    const arxivStartedAt = Date.now();

    if (paperId) {
      // Re-fetch by id so the abstract, version and links are authoritative — the
      // browser only ever supplied an identifier, never paper content.
      send({ type: "stage", stage: "reading" });

      try {
        // OpenAlex is the happy path; arXiv is the fallback for records it has
        // not indexed. An invalid id is a client error and never falls back.
        const viaOpenAlex = await getArxivPaperByOpenAlex(paperId).catch((error: unknown) => {
          if (error instanceof ArxivError && error.code === "INVALID_QUERY") throw error;

          console.warn("[generate] openalex lookup failed; falling back to arxiv", {
            paperId,
            code: error instanceof ArxivError ? error.code : "UNKNOWN",
          });
          return null;
        });

        const fetched = viaOpenAlex ?? (await getArxivPaper(paperId));
        if (!fetched) {
          streamFail(404, "That paper is no longer available. Pick another one.", "NO_PAPER");
          return;
        }
        paper = fetched;
      } catch (error) {
        const elapsedMs = Date.now() - arxivStartedAt;

        if (error instanceof ArxivError) {
          console.error("[generate] paper lookup failed", {
            code: error.code,
            status: error.status,
            elapsedMs,
            paperId,
          });

          streamFail(
            error.code === "INVALID_QUERY" ? 400 : isTransientArxivError(error) ? 503 : 502,
            error.code === "INVALID_QUERY"
              ? "That paper identifier is not valid. Pick a paper from the list."
              : error.code === "RATE_LIMITED"
                ? error.status === 429
                  ? "The paper index is rate-limiting requests right now. Wait about a minute, then try again."
                  : "The paper index is temporarily unavailable. Wait a minute, then try again."
                : isTransientArxivError(error)
                  ? "The paper index is not responding right now. Please try again."
                  : "Could not load that paper. Pick another one.",
            error.code,
          );
          return;
        }

        console.error("[generate] paper lookup threw", { elapsedMs, error });
        streamFail(502, "Could not load that paper.", "PAPER_LOOKUP_FAILED");
        return;
      }
    } else {
      let papers: ArxivPaper[] = [];
      send({ type: "stage", stage: "searching" });

      try {
        papers = await searchRecentArxiv(domain, 8);
      } catch (error) {
        const elapsedMs = Date.now() - arxivStartedAt;

        if (error instanceof ArxivError) {
          // This log line is the whole point: without it an outage produces a vague
          // message for the user and nothing at all for whoever debugs it.
          console.error("[generate] openalex failed", {
            code: error.code,
            status: error.status,
            elapsedMs,
            domain,
          });

          if (error.code === "RATE_LIMITED") {
            streamFail(
              503,
              error.status === 429
                ? "The paper index is rate-limiting requests right now. Wait about a minute, then try again."
                : "The paper index is temporarily unavailable. Wait a minute, then try again.",
              error.code,
            );
            return;
          }

          streamFail(
            isTransientArxivError(error) ? 503 : 400,
            isTransientArxivError(error)
              ? "The paper index is not responding right now. Please try again in a moment."
              : "That search could not be run. Try a broader domain.",
            error.code,
          );
          return;
        }

        console.error("[generate] openalex threw a non-ArxivError", { elapsedMs, error });
        streamFail(502, "Could not reach the paper index.", "OPENALEX_FAILED");
        return;
      }

      const picked = pickPaper(papers);
      if (!picked) {
        streamFail(
          404,
          "No recent paper matched that domain. Try a broader domain such as “Computer Vision”.",
          "NO_PAPER",
        );
        return;
      }
      paper = picked;
    }

    // Reporting the paper the moment it is known is the useful half of "reading":
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

    // Where the time went, for the log loop (D37): paper fetch + cache, LLM, save.
    const paperMs = Date.now() - arxivStartedAt;
    const llmStartedAt = Date.now();

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

    const llmMs = Date.now() - llmStartedAt;
    const saveStartedAt = Date.now();

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

    console.info("[generate] timings", {
      paperId: paper.arxivId,
      chosen: Boolean(paperId),
      paperMs,
      llmMs,
      saveMs: Date.now() - saveStartedAt,
      totalMs: Date.now() - pipelineStartedAt,
    });

    logEvent("generate_done", {
      chosen: Boolean(paperId),
      totalMs: Date.now() - pipelineStartedAt,
    });

    send({ type: "done", projectId: project.id });
  });
}
