/**
 * lib/openalex.ts
 *
 * OpenAlex discovery client for Synapse.
 *
 * Responsibility: a domain in -> strictly typed ArxivPaper[] out. OpenAlex is a
 * JSON index of scholarly works that *contains* arXiv records, so we filter to
 * the arXiv source and keep the rest of the pipeline unchanged: the same
 * `ArxivPaper` shape, the same `ArxivError` codes, the same `papers.arxiv_id`
 * cache key.
 *
 * Why not query arXiv directly? `export.arxiv.org` rate-limits by IP with
 * HTTP 429 and no key to raise the limit. Vercel functions share egress IPs, so
 * a browser that works can still leave the app throttled (BUG-016). OpenAlex
 * needs no key, allows 100k requests/day, and carries arXiv ids, abstracts and
 * authors.
 *
 * No Supabase, no LLM, no React imports. A pure boundary module.
 */

import {
  ArxivError,
  isValidArxivId,
  retryAfterDelayMs,
  type ArxivAuthor,
  type ArxivPaper,
} from "@/lib/arxiv";
import { OPENALEX_MAILTO } from "@/lib/env";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const OPENALEX_API_URL = "https://api.openalex.org/works";

/** OpenAlex's source id for arXiv (Cornell University). Verified 2026-10-27. */
export const ARXIV_SOURCE_ID = "S4306400194";

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RESULTS_LIMIT = 50;
const DEFAULT_MAX_RESULTS = 20;
/** Relevance search + a recency floor: the picker wants recent, buildable work. */
const RECENT_WINDOW_MONTHS = 6;
const MAX_CATEGORIES = 3;
const USER_AGENT = "Synapse/0.1 (+https://synapse-seven-ebon.vercel.app)";

/* -------------------------------------------------------------------------- */
/*  JSON shape helpers                                                         */
/* -------------------------------------------------------------------------- */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* -------------------------------------------------------------------------- */
/*  Abstract reconstruction                                                    */
/* -------------------------------------------------------------------------- */

/**
 * OpenAlex stores abstracts as an inverted index — `{ "word": [0, 5, 12] }` —
 * instead of a string, for legal/compactness reasons. Rebuilding it is a sort:
 * collect every (position, word) pair, order by position, join with spaces.
 *
 * A word can appear at several positions, and positions are not guaranteed to
 * be contiguous or sorted, so neither `Object.entries` order nor a simple join
 * is safe.
 */
export function abstractFromInvertedIndex(value: unknown): string {
  if (!isRecord(value)) return "";

  const words: Array<{ position: number; word: string }> = [];
  for (const [word, rawPositions] of Object.entries(value)) {
    for (const rawPosition of asArray(rawPositions)) {
      const position = typeof rawPosition === "number" ? rawPosition : Number(rawPosition);
      if (Number.isFinite(position)) words.push({ position, word });
    }
  }

  if (words.length === 0) return "";

  return words
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.word)
    .join(" ")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  arXiv id extraction                                                        */
/* -------------------------------------------------------------------------- */

const ARXIV_URL_PATTERN = /arxiv\.org\/(?:abs|pdf)\/([^?#]+)/i;

/**
 * Pulls a bare arXiv id out of an OpenAlex URL.
 *
 * Handles every shape OpenAlex actually returns:
 *   https://arxiv.org/abs/2610.00001v3
 *   https://arxiv.org/pdf/2610.00001v3.pdf
 *   http://arxiv.org/abs/cs/0112017          (legacy, and http not https)
 *
 * Returns null when the URL is not arXiv or the id fails the same validation
 * the by-id endpoint uses.
 */
export function arxivIdFromUrl(rawUrl: string): string | null {
  const match = ARXIV_URL_PATTERN.exec((rawUrl ?? "").trim());
  if (!match) return null;

  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    id = match[1];
  }

  id = id.replace(/\.pdf$/i, "").replace(/v\d+$/i, "").replace(/\/+$/, "");
  return isValidArxivId(id) ? id : null;
}

function collectLocations(work: UnknownRecord): UnknownRecord[] {
  const locations = asArray(work.locations).filter(isRecord);
  const primary = isRecord(work.primary_location) ? [work.primary_location] : [];
  return [...locations, ...primary];
}

function collectArxivId(work: UnknownRecord): string | null {
  for (const location of collectLocations(work)) {
    for (const url of [location.landing_page_url, location.pdf_url]) {
      const id = arxivIdFromUrl(readString(url));
      if (id) return id;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  OpenAlex work -> ArxivPaper mapping                                        */
/* -------------------------------------------------------------------------- */

function normaliseDate(value: unknown): string | null {
  const raw = readString(value);
  if (raw.length === 0) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function mapAuthors(work: UnknownRecord): ArxivAuthor[] {
  return asArray(work.authorships).flatMap((raw) => {
    if (!isRecord(raw) || !isRecord(raw.author)) return [];

    const name = readString(raw.author.display_name);
    if (name.length === 0) return [];

    const affiliation =
      asArray(raw.institutions)
        .filter(isRecord)
        .map((institution) => readString(institution.display_name))
        .find((value) => value.length > 0) ?? null;

    return [{ name, affiliation }];
  });
}

function mapCategories(work: UnknownRecord, fallbackDomain: string): {
  primaryCategory: string;
  categories: string[];
} {
  const primaryTopic = isRecord(work.primary_topic)
    ? readString(work.primary_topic.display_name)
    : "";

  const concepts = asArray(work.concepts)
    .map((concept) => (isRecord(concept) ? readString(concept.display_name) : ""))
    .filter((value) => value.length > 0);

  const categories = Array.from(new Set(concepts)).slice(0, MAX_CATEGORIES);
  const primaryCategory = primaryTopic || categories[0] || fallbackDomain;

  return {
    primaryCategory,
    categories: categories.length > 0 ? categories : [primaryCategory],
  };
}

function mapPdfUrl(work: UnknownRecord, arxivId: string): string {
  const best = isRecord(work.best_oa_location) ? readString(work.best_oa_location.pdf_url) : "";
  if (best.length > 0) return best;

  for (const location of collectLocations(work)) {
    const pdf = readString(location.pdf_url);
    if (pdf.length > 0) return pdf;
  }

  return `https://arxiv.org/pdf/${arxivId}`;
}

/**
 * Maps one OpenAlex work to the app's canonical paper shape.
 *
 * Returns null for rows the rest of the pipeline cannot use: no extractable
 * arXiv id, no title, no usable date, or a date in the future (OpenAlex
 * occasionally indexes ahead-of-print records).
 */
function mapWork(work: UnknownRecord, fallbackDomain: string, nowMs: number): ArxivPaper | null {
  const arxivId = collectArxivId(work);
  if (!arxivId) return null;

  const title = readString(work.title) || readString(work.display_name);
  if (title.length === 0) return null;

  const publishedDate = normaliseDate(work.publication_date);
  if (publishedDate === null) return null;
  if (Date.parse(publishedDate) > nowMs) return null;

  const { primaryCategory, categories } = mapCategories(work, fallbackDomain);
  const doi = readString(work.doi).replace(/^https?:\/\/doi\.org\//i, "");

  return {
    arxivId,
    // OpenAlex does not expose the arXiv version; the id is the cache key and
    // the by-id re-fetch is authoritative anyway.
    version: null,
    canonicalId: `https://arxiv.org/abs/${arxivId}`,
    title,
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    authors: mapAuthors(work),
    publishedDate,
    updatedDate: null,
    primaryCategory,
    categories,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: mapPdfUrl(work, arxivId),
    comment: null,
    journalRef: null,
    doi: doi.length > 0 ? doi : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Transport                                                                  */
/* -------------------------------------------------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Today minus N months", clamped to the start of the month when needed. */
export function monthsAgo(date: Date, months: number): string {
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()),
  );
  return toDateOnly(shifted);
}

/**
 * Fetches one OpenAlex page.
 *
 * Retry policy: exactly one retry, and only for 429/503. OpenAlex publishes
 * Retry-After, so we honour it (capped at 5s) instead of guessing. Timeouts and
 * network faults surface immediately — the caller has an arXiv fallback and a
 * second 10s wait would just make the user stare at a spinner.
 */
async function fetchOpenAlex(
  url: string,
  revalidateSeconds: number,
): Promise<UnknownRecord> {
  let lastError: ArxivError | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let waitMs = DEFAULT_RETRY_DELAY_MS;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Next.js server cache: one OpenAlex hit per hour per distinct query.
        next: { revalidate: revalidateSeconds },
      });

      if (response.status === 429 || response.status === 503) {
        lastError = new ArxivError(
          "RATE_LIMITED",
          response.status === 429
            ? "OpenAlex is rate limiting requests right now."
            : "OpenAlex is temporarily unavailable.",
          { status: response.status },
        );
        waitMs = retryAfterDelayMs(response, DEFAULT_RETRY_DELAY_MS);
      } else if (!response.ok) {
        throw new ArxivError("HTTP_ERROR", `OpenAlex responded with HTTP ${response.status}.`, {
          status: response.status,
        });
      } else {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new ArxivError("PARSE_ERROR", "OpenAlex returned a response we could not parse.", {
            cause,
          });
        }

        if (!isRecord(payload)) {
          throw new ArxivError("PARSE_ERROR", "OpenAlex returned an unexpected payload.");
        }

        return payload;
      }
    } catch (error) {
      if (error instanceof ArxivError) {
        // Only 429/503 get a second attempt; a malformed payload is final.
        if (error.code === "PARSE_ERROR") throw error;
        if (error.code === "HTTP_ERROR" && (error.status ?? 500) < 500) throw error;
        lastError = error;
      } else if (isAbortError(error)) {
        throw new ArxivError(
          "TIMEOUT",
          `OpenAlex did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
          { cause: error },
        );
      } else {
        throw new ArxivError("NETWORK_ERROR", "Could not reach OpenAlex.", { cause: error });
      }
    }

    if (attempt < 2) await sleep(waitMs);
  }

  throw lastError ?? new ArxivError("NETWORK_ERROR", "OpenAlex request failed.");
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface OpenAlexOptions {
  /** Injectable clock, so the recency window is testable. */
  now?: Date;
  /** Next.js server-side fetch cache lifetime in seconds. Default 3600. */
  revalidateSeconds?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildUrl(params: URLSearchParams): string {
  if (OPENALEX_MAILTO.length > 0) params.set("mailto", OPENALEX_MAILTO);
  return `${OPENALEX_API_URL}?${params.toString()}`;
}

/**
 * Searches OpenAlex for recent arXiv papers in a domain.
 *
 * The search term is the domain only. Language is a roadmap input, not a
 * property of a paper — including it here filtered out relevant work (the old
 * `"Computer Vision Python"` query) and produced the empty-result path.
 *
 * A valid domain with zero recent matches returns `[]`: an empty result is
 * data, not an exception.
 *
 * @throws {ArxivError} INVALID_QUERY for an empty domain, plus the transport
 *   codes (TIMEOUT / NETWORK_ERROR / RATE_LIMITED / HTTP_ERROR / PARSE_ERROR).
 */
export async function searchRecentArxiv(
  domain: string,
  limit: number = DEFAULT_MAX_RESULTS,
  options: OpenAlexOptions = {},
): Promise<ArxivPaper[]> {
  const term = (domain ?? "").normalize("NFKC").trim();
  if (term.length === 0) {
    throw new ArxivError("INVALID_QUERY", "A domain is required to search papers.");
  }

  const { now = new Date(), revalidateSeconds = 3600 } = options;
  const cappedLimit = clamp(Math.trunc(Number(limit) || DEFAULT_MAX_RESULTS), 1, MAX_RESULTS_LIMIT);

  const params = new URLSearchParams({
    // Relevance-ranked on purpose. Sorting by date in the query would surface
    // the newest papers regardless of whether they match the domain.
    filter: `locations.source.id:${ARXIV_SOURCE_ID},from_publication_date:${monthsAgo(now, RECENT_WINDOW_MONTHS)}`,
    search: `"${term}"`,
    "per-page": String(MAX_RESULTS_LIMIT),
  });

  const payload = await fetchOpenAlex(buildUrl(params), revalidateSeconds);
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const papers: ArxivPaper[] = [];

  for (const raw of asArray(payload.results)) {
    if (!isRecord(raw)) continue;
    const paper = mapWork(raw, term, nowMs);
    if (!paper || seen.has(paper.arxivId)) continue;
    seen.add(paper.arxivId);
    papers.push(paper);
  }

  // Newest first among the 50 most relevant, then hand the shortlist to
  // rankCandidates(), which applies the product's own recency rule.
  papers.sort((a, b) => Date.parse(b.publishedDate ?? "") - Date.parse(a.publishedDate ?? ""));
  return papers.slice(0, cappedLimit);
}

/**
 * Fetches exactly one paper by its arXiv id through OpenAlex.
 *
 * This is the happy path for a chosen paper (D41). It looks the id up in both
 * URL schemes because OpenAlex stores older records as `http://arxiv.org/...`
 * and newer ones as `https://...`; the `|` is OpenAlex's OR operator.
 *
 * Returns null when OpenAlex has no record, so the caller can fall back to the
 * arXiv API rather than failing the generation.
 *
 * @throws {ArxivError} INVALID_QUERY for a malformed id, plus transport codes.
 */
export async function getArxivPaperByOpenAlex(
  arxivId: string,
  options: OpenAlexOptions = {},
): Promise<ArxivPaper | null> {
  const id = (arxivId ?? "").trim();
  if (!isValidArxivId(id)) {
    throw new ArxivError("INVALID_QUERY", "That does not look like an arXiv identifier.");
  }

  const { now = new Date(), revalidateSeconds = 3600 } = options;

  const params = new URLSearchParams({
    filter: `locations.landing_page_url:http://arxiv.org/abs/${id}|https://arxiv.org/abs/${id}`,
    "per-page": "5",
  });

  const payload = await fetchOpenAlex(buildUrl(params), revalidateSeconds);
  const nowMs = now.getTime();

  for (const raw of asArray(payload.results)) {
    if (!isRecord(raw)) continue;
    const paper = mapWork(raw, "arXiv", nowMs);
    if (paper && paper.arxivId === id) return paper;
  }

  return null;
}
