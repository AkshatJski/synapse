import { NextResponse } from "next/server";
import { z } from "zod";

import { ArxivError, isTransientArxivError, searchArxivPapers } from "@/lib/arxiv";
import { isSupabaseConfigured } from "@/lib/env";
import { rankCandidates, toCandidate } from "@/lib/papers";
import { DOMAINS, LANGUAGES } from "@/lib/roadmap";
import { papersLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const SEARCH_POOL = 20;
const CANDIDATES_SHOWN = 3;

const BodySchema = z.object({
  // Enum, not free text: it bounds the number of distinct arXiv queries this
  // endpoint can ever issue (DOMAINS x LANGUAGES), and all of them are cached.
  domain: z.enum(DOMAINS),
  language: z.enum(LANGUAGES),
  /** Papers the user has already seen, so "shuffle" can return new ones. */
  exclude: z.array(z.string().trim().min(1).max(32)).max(30).optional(),
});

function fail(status: number, message: string, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Returns up to three paper candidates for the picker (D41).
 *
 * Reading only — nothing is written to the database and no LLM is called, which
 * is why shuffling costs no generation quota. The client never supplies paper
 * content; it receives candidates and later sends back only an arXiv id, which
 * `/api/generate` re-fetches by id.
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
    return fail(400, "Pick a domain and a language from the list.", "BAD_REQUEST");
  }

  if (!isSupabaseConfigured()) {
    return fail(503, "Synapse is not connected to a database yet.", "NOT_CONFIGURED");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail(401, "Please sign in to search for papers.", "UNAUTHENTICATED");
  }

  // Best-effort speed bump, per warm instance (D44). The real cost guard is the
  // daily per-user generation quota; this one just stops tight loops.
  const limit = papersLimiter.check(user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many searches in a row. Wait a few seconds and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { domain, language, exclude = [] } = parsed.data;

  let papers;
  try {
    papers = await searchArxivPapers(`${domain} ${language}`, SEARCH_POOL);
    if (papers.length === 0) {
      // Same second chance as the generate pipeline: the language term can filter
      // out every relevant hit.
      papers = await searchArxivPapers(domain, SEARCH_POOL, { sortBy: "submittedDate" });
    }
  } catch (error) {
    if (error instanceof ArxivError) {
      console.error("[papers] arxiv failed", {
        code: error.code,
        status: error.status,
        query: `${domain} ${language}`,
      });

      return fail(
        isTransientArxivError(error) ? 503 : 400,
        isTransientArxivError(error)
          ? "arXiv is not responding right now. Try again in a moment."
          : "That search could not be run against arXiv. Try a broader domain.",
        error.code,
      );
    }

    console.error("[papers] arxiv threw a non-ArxivError", error);
    return fail(502, "Could not reach arXiv.", "ARXIV_FAILED");
  }

  if (papers.length === 0) {
    return fail(
      404,
      "No arXiv paper matched that combination. Try a broader domain.",
      "NO_PAPER",
    );
  }

  const candidates = rankCandidates(papers, { limit: CANDIDATES_SHOWN, exclude });

  console.info("[papers] candidates", {
    domain,
    language,
    pool: papers.length,
    excluded: exclude.length,
    returned: candidates.length,
  });

  return NextResponse.json({
    candidates: candidates.map((paper) => toCandidate(paper)),
    // The pool was not empty, but everything in it had already been shown.
    exhausted: candidates.length === 0,
  });
}
