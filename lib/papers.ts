/**
 * lib/papers.ts
 *
 * Pure selection logic for the paper picker (D41).
 *
 * `searchArxivPapers()` answers "what does arXiv think matches this query?".
 * That is relevance order, which is not the same as "what would a learner want
 * to build today". This module applies the product's judgement — prefer recent
 * work, never show the same paper twice, never re-show one the user skipped —
 * and keeps it pure so it can be tested without an API key or a network.
 */

import type { ArxivPaper } from "@/lib/arxiv";

/** Papers older than this are still candidates, just after the recent ones. */
export const RECENCY_WINDOW_YEARS = 5;

const RECENCY_WINDOW_MS = RECENCY_WINDOW_YEARS * 365 * 24 * 60 * 60 * 1000;
const PREVIEW_MAX_CHARS = 280;

/** What the browser is allowed to see: a slim, already-truncated shape. */
export interface PaperCandidate {
  arxivId: string;
  title: string;
  /** Two-or-three-line summary for the card. */
  abstractPreview: string;
  publishedDate: string | null;
  /** Whole years since publication, or null when arXiv sent no usable date. */
  ageYears: number | null;
  primaryCategory: string | null;
  authors: string[];
  absUrl: string;
  pdfUrl: string | null;
}

export interface RankOptions {
  limit?: number;
  /** Ids the user has already seen (shuffle). */
  exclude?: string[];
  /** Injectable clock, so tests are not time-dependent. */
  now?: number;
}

function parsePublished(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Relevance order, split into "recent first", deduped, minus exclusions.
 *
 * The split is a stable partition, not a sort: within each group arXiv's
 * relevance order is preserved. Sorting by date instead would surface a
 * decade-old paper just because it is newer than another decade-old paper.
 */
export function rankCandidates(papers: ArxivPaper[], options: RankOptions = {}): ArxivPaper[] {
  const { limit = 3, exclude = [], now = Date.now() } = options;
  const seen = new Set(exclude);
  const unique: ArxivPaper[] = [];

  for (const paper of papers) {
    if (!paper?.arxivId || seen.has(paper.arxivId)) continue;
    seen.add(paper.arxivId);
    unique.push(paper);
  }

  const cutoff = now - RECENCY_WINDOW_MS;
  const recent: ArxivPaper[] = [];
  const older: ArxivPaper[] = [];

  for (const paper of unique) {
    const published = parsePublished(paper.publishedDate);
    if (published !== null && published >= cutoff) recent.push(paper);
    else older.push(paper);
  }

  return [...recent, ...older].slice(0, Math.max(0, Math.trunc(limit)));
}

/** Trims to a word boundary so the card never ends mid-word with a hard cut. */
function preview(text: string, max = PREVIEW_MAX_CHARS): string {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "");

  return `${body}…`;
}

/** Maps a full paper to the only fields the picker needs. */
export function toCandidate(paper: ArxivPaper, now = Date.now()): PaperCandidate {
  const published = parsePublished(paper.publishedDate);

  return {
    arxivId: paper.arxivId,
    title: paper.title,
    abstractPreview: preview(paper.abstract),
    publishedDate: paper.publishedDate,
    ageYears:
      published === null ? null : Math.max(0, Math.floor((now - published) / (365 * 24 * 60 * 60 * 1000))),
    primaryCategory: paper.primaryCategory,
    authors: paper.authors.map((author) => author.name),
    absUrl: paper.absUrl,
    pdfUrl: paper.pdfUrl,
  };
}
