/**
 * lib/arxiv.ts
 *
 * arXiv Atom API client for Synapse.
 *
 * Responsibility: query string in -> strictly typed ArxivPaper[] out.
 * No Supabase, no LLM, no React imports. This is a pure boundary module.
 *
 * Every failure mode throws an ArxivError carrying a machine-readable `code`,
 * so callers can distinguish "retry me" from "the user typed something wrong".
 */

import { XMLParser } from "fast-xml-parser";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const ARXIV_API_URL = "https://export.arxiv.org/api/query";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 750;
const MAX_RESULTS_LIMIT = 50;
const DEFAULT_MAX_RESULTS = 10;
const USER_AGENT = "Synapse/0.1 (academic-paper-to-project-roadmap)";

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ArxivErrorCode =
  | "INVALID_QUERY"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "RATE_LIMITED"
  | "PARSE_ERROR";

export class ArxivError extends Error {
  readonly code: ArxivErrorCode;
  readonly status?: number;

  constructor(
    code: ArxivErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ArxivError";
    this.code = code;
    this.status = options?.status;
  }
}

/** True when the right move is "try again later" rather than "fix your input". */
export function isTransientArxivError(error: unknown): boolean {
  return (
    error instanceof ArxivError &&
    (error.code === "TIMEOUT" ||
      error.code === "NETWORK_ERROR" ||
      error.code === "RATE_LIMITED" ||
      (error.code === "HTTP_ERROR" && (error.status ?? 500) >= 500))
  );
}

/* -------------------------------------------------------------------------- */
/*  Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface ArxivAuthor {
  name: string;
  affiliation: string | null;
}

export interface ArxivPaper {
  /** Bare identifier with the version suffix stripped, e.g. "2301.12345" or "cs/0112017". */
  arxivId: string;
  /** "v2" or null, kept separately so a paper can be re-fetched at a pinned version. */
  version: string | null;
  /** Absolute canonical URL as arXiv reported it, e.g. "http://arxiv.org/abs/2301.12345v2". */
  canonicalId: string;
  title: string;
  abstract: string;
  authors: ArxivAuthor[];
  /** ISO-8601 string, or null when arXiv sent an unparseable date. */
  publishedDate: string | null;
  updatedDate: string | null;
  primaryCategory: string | null;
  categories: string[];
  absUrl: string;
  pdfUrl: string | null;
  comment: string | null;
  journalRef: string | null;
  doi: string | null;
}

export interface SearchArxivOptions {
  /** arXiv only supports these two sort keys. Default "relevance". */
  sortBy?: "relevance" | "submittedDate";
  /** arXiv field prefix: "all", "ti", "abs", "au", "cat", ... Default "all". */
  field?: string;
  /** Next.js server-side fetch cache lifetime in seconds. Default 3600. */
  revalidateSeconds?: number;
}

/* -------------------------------------------------------------------------- */
/*  XML shape helpers                                                          */
/*                                                                             */
/*  fast-xml-parser gives loosely typed trees: a tag is a string, an object    */
/*  with "#text", an array, or absent. These helpers normalise that noise so   */
/*  the mapping code below can stay readable.                                  */
/* -------------------------------------------------------------------------- */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Reads a tag value whether the parser returned a string, number or { "#text" }. */
function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readText).filter(Boolean).join(" ");
  if (isRecord(value)) {
    for (const key of ["#text", "__text"]) {
      if (key in value) return readText(value[key]);
    }
  }
  return "";
}

/** Collapses arXiv's hard-wrapped abstracts (newlines + double spaces) to one line. */
function cleanText(value: unknown): string {
  return readText(value).replace(/[\s\u00a0]+/g, " ").trim();
}

/** First non-empty value among candidates — handles namespaced vs bare tag names. */
function optionalText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text.length > 0) return text;
  }
  return null;
}

function readAttr(value: unknown, attribute: string): string | null {
  if (!isRecord(value)) return null;
  const raw = value[`@_${attribute}`];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function normaliseDate(value: string): string | null {
  if (value.length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

/* -------------------------------------------------------------------------- */
/*  XML parser (module-level singleton — constructing one per call is wasteful) */
/* -------------------------------------------------------------------------- */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  // Keep every leaf a string. arXiv ids like "2301.12345" must not become floats,
  // and dates like "2023-01-09" must not be coerced into numbers.
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  // Atom repeats these tags; forcing arrays means callers never branch on cardinality.
  isArray: (tagName) =>
    tagName === "entry" || tagName === "author" || tagName === "link" || tagName === "category",
});

/* -------------------------------------------------------------------------- */
/*  Atom -> ArxivPaper mapping                                                 */
/* -------------------------------------------------------------------------- */

const ARXIV_ID_PATTERN = /\/abs\/(.+?)(v\d+)?$/i;

/** Splits "http://arxiv.org/abs/2301.12345v2" into id + version. */
export function splitArxivId(canonicalId: string): { arxivId: string; version: string | null } {
  const trimmed = canonicalId.trim().replace(/[?#].*$/, "");
  const match = ARXIV_ID_PATTERN.exec(trimmed);
  if (!match) return { arxivId: trimmed, version: null };
  return { arxivId: match[1], version: match[2] ?? null };
}

interface AtomLink {
  href: string;
  rel: string | null;
  title: string | null;
  type: string | null;
}

function collectLinks(value: unknown): AtomLink[] {
  return asArray(value).flatMap((raw) => {
    const href = readAttr(raw, "href");
    if (!href) return [];
    return [
      {
        href,
        rel: readAttr(raw, "rel"),
        title: readAttr(raw, "title"),
        type: readAttr(raw, "type"),
      },
    ];
  });
}

function mapEntry(entry: UnknownRecord): ArxivPaper | null {
  const canonicalId = cleanText(entry.id);
  const title = cleanText(entry.title);

  // A malformed entry is skipped rather than poisoning the whole result set.
  if (canonicalId.length === 0 || title.length === 0) return null;

  const { arxivId, version } = splitArxivId(canonicalId);
  const links = collectLinks(entry.link);

  const absUrl =
    links.find((link) => link.rel === "alternate")?.href ?? `https://arxiv.org/abs/${arxivId}`;
  const pdfUrl =
    links.find((link) => link.title === "pdf" || link.type === "application/pdf")?.href ?? null;

  const authors = asArray(entry.author).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const name = cleanText(raw.name);
    if (name.length === 0) return [];
    const affiliation = optionalText(raw["arxiv:affiliation"], raw.affiliation);
    return [{ name, affiliation }];
  });

  const categoryTerms = asArray(entry.category)
    .map((raw) => readAttr(raw, "term"))
    .filter((term): term is string => term !== null);

  const primaryCategory =
    readAttr(entry["arxiv:primary_category"], "term") ??
    readAttr(entry.primary_category, "term") ??
    categoryTerms[0] ??
    null;

  return {
    arxivId,
    version,
    canonicalId,
    title,
    abstract: cleanText(entry.summary),
    authors,
    publishedDate: normaliseDate(cleanText(entry.published)),
    updatedDate: normaliseDate(cleanText(entry.updated)),
    primaryCategory,
    categories: Array.from(new Set(categoryTerms)),
    absUrl,
    pdfUrl,
    comment: optionalText(entry["arxiv:comment"], entry.comment),
    journalRef: optionalText(entry["arxiv:journal_ref"], entry.journal_ref),
    doi: optionalText(entry["arxiv:doi"], entry.doi),
  };
}

/**
 * Parses a raw arXiv Atom feed into typed papers.
 *
 * Exported separately from the network call so it can be unit-tested against a
 * saved fixture with zero network access.
 */
export function parseAtomFeed(xml: string): ArxivPaper[] {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch (cause) {
    throw new ArxivError("PARSE_ERROR", "arXiv returned a response we could not parse.", {
      cause,
    });
  }

  const feed = isRecord(parsed) ? parsed.feed : undefined;
  if (!isRecord(feed)) {
    throw new ArxivError("PARSE_ERROR", "arXiv response is missing the expected <feed> element.");
  }

  const entries = asArray(feed.entry);
  const papers: ArxivPaper[] = [];
  for (const rawEntry of entries) {
    if (!isRecord(rawEntry)) continue;
    const paper = mapEntry(rawEntry);
    if (paper) papers.push(paper);
  }
  return papers;
}

/* -------------------------------------------------------------------------- */
/*  Query building                                                             */
/* -------------------------------------------------------------------------- */

/**
 * arXiv treats a space between terms as OR (and it is very loose about it), so
 * multi-word input is split and joined with an explicit AND to keep relevance.
 *
 * An already-formed arXiv expression such as "cat:cs.CV" passes through intact.
 */
export function buildSearchQuery(rawQuery: string, field = "all"): string {
  const raw = (rawQuery ?? "").normalize("NFKC").trim();

  if (raw.length === 0) {
    throw new ArxivError("INVALID_QUERY", "A search query with at least one keyword is required.");
  }

  if (/^[a-z]+:/i.test(raw) && !/\s/.test(raw)) return raw;

  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.replace(/[()"[\]{}]/g, ""))
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new ArxivError("INVALID_QUERY", "A search query with at least one keyword is required.");
  }

  return tokens.map((token) => `${field}:${token}`).join(" AND ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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

/**
 * Fetches the Atom feed with bounded retries.
 *
 * Retry policy:
 *  - 429 / 503  -> arXiv asking us to slow down  -> retry with exponential backoff
 *  - 5xx        -> transient server fault        -> retry
 *  - other 4xx  -> our request is wrong          -> fail fast, retrying cannot help
 *  - timeout    -> retry
 */
async function fetchAtomFeed(url: string, revalidateSeconds: number): Promise<string> {
  let lastError: ArxivError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Next.js server cache: at most one arXiv hit per hour per distinct query.
        next: { revalidate: revalidateSeconds },
      });

      if (response.status === 429 || response.status === 503) {
        lastError = new ArxivError(
          "RATE_LIMITED",
          "arXiv is rate limiting requests right now. Please try again shortly.",
          { status: response.status },
        );
      } else if (!response.ok) {
        throw new ArxivError("HTTP_ERROR", `arXiv responded with HTTP ${response.status}.`, {
          status: response.status,
        });
      } else {
        const xml = await response.text();
        if (!xml.includes("<feed")) {
          throw new ArxivError("PARSE_ERROR", "arXiv did not return an Atom feed.");
        }
        return xml;
      }
    } catch (error) {
      if (error instanceof ArxivError) {
        if (error.code === "HTTP_ERROR" && (error.status ?? 500) < 500) throw error;
        lastError = error;
      } else if (isAbortError(error)) {
        lastError = new ArxivError(
          "TIMEOUT",
          "arXiv did not respond within 15 seconds. Please try again.",
          { cause: error },
        );
      } else {
        lastError = new ArxivError("NETWORK_ERROR", "Could not reach arXiv.", { cause: error });
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)); // 750ms, then 1500ms
    }
  }

  throw lastError ?? new ArxivError("NETWORK_ERROR", "arXiv request failed.");
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Searches arXiv and returns strictly typed papers.
 *
 * A valid query with zero matches returns `[]` — an empty result is data, not
 * an exception, so the caller decides how to present it.
 *
 * @throws {ArxivError} INVALID_QUERY (bad input), PARSE_ERROR (bad feed), or
 *   TIMEOUT / NETWORK_ERROR / RATE_LIMITED / HTTP_ERROR after 3 attempts.
 */
export async function searchArxivPapers(
  query: string,
  maxResults: number = DEFAULT_MAX_RESULTS,
  options: SearchArxivOptions = {},
): Promise<ArxivPaper[]> {
  const { sortBy = "relevance", field = "all", revalidateSeconds = 3600 } = options;

  const searchQuery = buildSearchQuery(query, field);
  const limit = clamp(Math.trunc(Number(maxResults) || DEFAULT_MAX_RESULTS), 1, MAX_RESULTS_LIMIT);

  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(limit),
    sortBy,
    sortOrder: "descending",
  });

  const xml = await fetchAtomFeed(`${ARXIV_API_URL}?${params.toString()}`, revalidateSeconds);
  return parseAtomFeed(xml);
}
