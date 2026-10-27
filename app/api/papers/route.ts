import { NextResponse } from "next/server";
import { z } from "zod";

import { ArxivError, arxivIdFromInput, isTransientArxivError } from "@/lib/arxiv";
import { isSupabaseConfigured } from "@/lib/env";
import { searchRecentArxiv } from "@/lib/openalex";
import { fetchPaperById } from "@/lib/paper-lookup";
import { rankCandidates, toCandidate } from "@/lib/papers";
import { DOMAINS, LANGUAGES } from "@/lib/roadmap";
import { papersLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const SEARCH_POOL = 20;
const CANDIDATES_SHOWN = 3;

const SearchSchema = z.object({
  // Enum, not free text: it bounds the number of distinct paper queries this
  // endpoint can ever issue (DOMAINS), and all of them are cached.
  domain: z.enum(DOMAINS),
  language: z.enum(LANGUAGES),
  /** Papers the user has already seen, so "shuffle" can return new ones. */
  exclude: z.array(z.string().trim().min(1).max(32)).max(30).optional(),
});

const LookupSchema = z.object({
  /** A pasted arXiv link or bare id. The server extracts and re-fetches it. */
  paperId: z.string().trim().min(1).max(200),
});

const BodySchema = z.union([LookupSchema, SearchSchema]);

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
    return fail(
      400,
      "Send an arXiv link or id, or pick a domain and a language.",
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

  // "I have a paper": the browser sends the pasted link/id, never paper content.
  // The server extracts a bare id and re-fetches it (D41), so a tampered client
  // cannot inject an abstract into the roadmap prompt.
  if ("paperId" in parsed.data) {
    const paperId = arxivIdFromInput(parsed.data.paperId);
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
        console.error("[papers] lookup failed", {
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

      console.error("[papers] lookup threw a non-ArxivError", error);
      return fail(502, "Could not reach the paper index.", "OPENALEX_FAILED");
    }

    if (!paper) {
      return fail(
        404,
        "We could not find that paper on arXiv. Check the link or id and try again.",
        "NO_PAPER",
      );
    }

    console.info("[papers] lookup", { paperId, found: true });
    return NextResponse.json({ candidates: [toCandidate(paper)], exhausted: false });
  }

  const { domain, language, exclude = [] } = parsed.data;

  let papers;
  try {
    papers = await searchRecentArxiv(domain, SEARCH_POOL);
  } catch (error) {
    if (error instanceof ArxivError) {
      console.error("[papers] openalex failed", {
        code: error.code,
        status: error.status,
        domain,
      });

      const transient = isTransientArxivError(error);
      return fail(
        transient ? 503 : 400,
        error.code === "RATE_LIMITED"
          ? "The paper index is rate-limiting requests right now — try again in about a minute."
          : transient
            ? "The paper index is not responding right now. Try again in a moment."
            : "That search could not be run. Try a broader domain.",
        error.code,
      );
    }

    console.error("[papers] openalex threw a non-ArxivError", error);
    return fail(502, "Could not reach the paper index.", "OPENALEX_FAILED");
  }

  if (papers.length === 0) {
    return fail(
      404,
      "No recent paper matched that domain. Try a broader domain.",
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
