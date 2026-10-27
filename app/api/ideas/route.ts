import { NextResponse } from "next/server";
import { z } from "zod";

import { ArxivError, arxivIdFromInput, isTransientArxivError } from "@/lib/arxiv";
import { isSupabaseConfigured } from "@/lib/env";
import { generateProjectIdeas, LlmError } from "@/lib/llm";
import { fetchPaperById } from "@/lib/paper-lookup";
import { DOMAINS, LANGUAGES, SKILL_LEVELS } from "@/lib/roadmap";
import { ideasLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const BodySchema = z.object({
  domain: z.enum(DOMAINS),
  language: z.enum(LANGUAGES),
  skillLevel: z.enum(SKILL_LEVELS),
  /** A pasted arXiv link or bare id. The server re-fetches it by id (D41). */
  paperId: z.string().trim().min(1).max(200),
});

function fail(
  status: number,
  message: string,
  code: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ error: message, code }, { status, headers });
}

/**
 * "What could I build with this paper?"
 *
 * Reading only: no database writes and no generation quota. The paper is
 * re-fetched by id, then one cheap LLM call proposes three projects. The chosen
 * idea travels to `/api/generate` as bounded prompt text, so no schema change is
 * needed to remember it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Request body must be valid JSON.", "BAD_REQUEST");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      "Pick a domain, a language, a skill level and a paper.",
      "BAD_REQUEST",
    );
  }

  if (!isSupabaseConfigured()) {
    return fail(503, "Synapse is not connected to a database yet.", "NOT_CONFIGURED");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail(401, "Please sign in to see project ideas.", "UNAUTHENTICATED");
  }

  const limit = ideasLimiter.check(user.id);
  if (!limit.ok) {
    return fail(
      429,
      "Too many idea requests in a row. Wait a few seconds and try again.",
      "RATE_LIMITED",
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const { domain, language, skillLevel, paperId: rawPaperId } = parsed.data;
  const paperId = arxivIdFromInput(rawPaperId);
  if (!paperId) {
    return fail(
      400,
      "That does not look like an arXiv link or id. Try https://arxiv.org/abs/1706.03762 or 1706.03762.",
      "INVALID_PAPER_ID",
    );
  }

  let paper;
  try {
    paper = await fetchPaperById(paperId);
  } catch (error) {
    if (error instanceof ArxivError) {
      console.error("[ideas] paper lookup failed", {
        paperId,
        code: error.code,
        status: error.status,
      });

      const transient = isTransientArxivError(error);
      return fail(
        transient ? 503 : 400,
        error.code === "RATE_LIMITED"
          ? "The paper index is rate-limiting requests right now — try again in about a minute."
          : transient
            ? "The paper index is not responding right now. Try again in a moment."
            : "That paper could not be loaded. Check the link or id.",
        error.code,
      );
    }

    console.error("[ideas] paper lookup threw a non-ArxivError", error);
    return fail(502, "Could not reach the paper index.", "OPENALEX_FAILED");
  }

  if (!paper) {
    return fail(
      404,
      "We could not find that paper on arXiv. Check the link or id and try again.",
      "NO_PAPER",
    );
  }

  try {
    const ideas = await generateProjectIdeas({ paper, domain, language, skillLevel });

    console.info("[ideas] generated", {
      paperId,
      domain,
      language,
      skillLevel,
      count: ideas.length,
    });

    return NextResponse.json({ ideas });
  } catch (error) {
    if (error instanceof LlmError) {
      console.error("[ideas] llm failed", {
        paperId,
        code: error.code,
        status: error.status,
      });

      if (error.code === "RATE_LIMITED") {
        return fail(
          429,
          "The AI provider is rate limiting requests right now. Try again in about a minute.",
          "RATE_LIMITED",
          { "Retry-After": "60" },
        );
      }

      if (error.code === "NO_PROVIDER") {
        return fail(503, "No AI provider is configured.", "NO_PROVIDER");
      }

      return fail(
        502,
        "The AI could not propose projects for this paper. Try again in a moment.",
        error.code,
      );
    }

    console.error("[ideas] unexpected error", error);
    return fail(500, "Something went wrong while proposing projects.", "INTERNAL_ERROR");
  }
}
