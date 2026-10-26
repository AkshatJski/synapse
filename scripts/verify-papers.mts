/**
 * scripts/verify-papers.mts
 *
 * Offline regression check for the paper picker (D41): `rankCandidates()` and
 * `toCandidate()` in lib/papers.ts, plus id validation in `getArxivPaper()`.
 * No network, no Supabase, no LLM.
 *
 * Why this exists: these rules decide which paper a learner builds a roadmap
 * from. They are easy to break silently — a sort that reorders a decade-old
 * paper above a relevant recent one, a dedupe that lets the same paper come back
 * on shuffle, an off-by-one that shows four cards. Every assertion below is a
 * product rule, not an implementation detail.
 *
 * Run with:  npm run verify:papers
 */

import { ArxivError, getArxivPaper, type ArxivPaper } from "@/lib/arxiv";
import { rankCandidates, toCandidate, RECENCY_WINDOW_YEARS } from "@/lib/papers";

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${JSON.stringify(expected).slice(0, 160)}`);
    console.log(`       actual   ${JSON.stringify(actual).slice(0, 160)}`);
    return;
  }
  console.log(`  ok   ${label}`);
}

function expectRejects(label: string, fn: () => Promise<unknown>, code: string) {
  return fn().then(
    () => {
      failures += 1;
      console.log(`  FAIL ${label} — resolved instead of rejecting`);
    },
    (error) => {
      const actual = error instanceof ArxivError ? error.code : "NOT_ARXIV_ERROR";
      expect(label, actual, code);
    },
  );
}

/** Fixed clock: 2026-10-26T00:00:00Z. Nothing here depends on "now". */
const NOW = Date.UTC(2026, 9, 26);
const YEARS = 365 * 24 * 60 * 60 * 1000;

function paper(overrides: Partial<ArxivPaper> & { arxivId: string }): ArxivPaper {
  const { arxivId, ...rest } = overrides;

  return {
    arxivId,
    version: null,
    canonicalId: `http://arxiv.org/abs/${arxivId}`,
    title: `Paper ${arxivId}`,
    abstract: `Abstract for ${arxivId}.`,
    authors: [{ name: "A. Author", affiliation: null }],
    publishedDate: new Date(NOW - 1 * YEARS).toISOString(),
    updatedDate: null,
    primaryCategory: "cs.LG",
    categories: ["cs.LG"],
    absUrl: `http://arxiv.org/abs/${arxivId}`,
    pdfUrl: `http://arxiv.org/pdf/${arxivId}`,
    comment: null,
    journalRef: null,
    doi: null,
    ...rest,
  };
}

const ids = (papers: ArxivPaper[]) => papers.map((item) => item.arxivId);

console.log("\n[1] recent papers first, relevance order preserved inside each group");

{
  const ranked = rankCandidates(
    [
      paper({ arxivId: "old-1", publishedDate: new Date(NOW - 9 * YEARS).toISOString() }),
      paper({ arxivId: "new-1", publishedDate: new Date(NOW - 1 * YEARS).toISOString() }),
      paper({ arxivId: "old-2", publishedDate: new Date(NOW - 7 * YEARS).toISOString() }),
      paper({ arxivId: "new-2", publishedDate: new Date(NOW - 2 * YEARS).toISOString() }),
    ],
    { limit: 10, now: NOW },
  );

  expect("stable partition, not a date sort", ids(ranked), ["new-1", "new-2", "old-1", "old-2"]);
}

console.log(`\n[2] the recency window is ${RECENCY_WINDOW_YEARS} years, inclusive`);

{
  const inside = paper({
    arxivId: "inside",
    publishedDate: new Date(NOW - (RECENCY_WINDOW_YEARS * YEARS - 1000)).toISOString(),
  });
  const outside = paper({
    arxivId: "outside",
    publishedDate: new Date(NOW - (RECENCY_WINDOW_YEARS * YEARS + 1000)).toISOString(),
  });

  expect("just inside the window wins", ids(rankCandidates([outside, inside], { limit: 2, now: NOW })), [
    "inside",
    "outside",
  ]);
}

console.log("\n[3] undated papers are still candidates, but last");

{
  const ranked = rankCandidates(
    [
      paper({ arxivId: "undated", publishedDate: null }),
      paper({ arxivId: "recent", publishedDate: new Date(NOW - YEARS).toISOString() }),
      paper({ arxivId: "garbled", publishedDate: "not a date" }),
    ],
    { limit: 3, now: NOW },
  );

  expect("recent first, then null and unparseable", ids(ranked), ["recent", "undated", "garbled"]);
}

console.log("\n[4] duplicates collapse to the first (most relevant) occurrence");

{
  const ranked = rankCandidates(
    [
      paper({ arxivId: "dup", title: "First copy" }),
      paper({ arxivId: "other" }),
      paper({ arxivId: "dup", title: "Second copy" }),
    ],
    { limit: 3, now: NOW },
  );

  expect("one row per arXiv id", ids(ranked), ["dup", "other"]);
  expect("the first copy wins", ranked[0].title, "First copy");
}

console.log("\n[5] shuffle excludes what the user has already seen");

{
  const pool = [paper({ arxivId: "a" }), paper({ arxivId: "b" }), paper({ arxivId: "c" })];
  const ranked = rankCandidates(pool, { limit: 3, exclude: ["a", "c"], now: NOW });

  expect("only unseen ids", ids(ranked), ["b"]);
  expect(
    "everything seen means nothing returned",
    ids(rankCandidates(pool, { limit: 3, exclude: ["a", "b", "c"], now: NOW })),
    [],
  );
}

console.log("\n[6] limit and edge cases");

{
  const pool = ["a", "b", "c", "d", "e"].map((id) => paper({ arxivId: id }));

  expect("default-ish limit of 3", ids(rankCandidates(pool, { limit: 3, now: NOW })), ["a", "b", "c"]);
  expect("fewer results than the limit", ids(rankCandidates([paper({ arxivId: "solo" })], { now: NOW })), [
    "solo",
  ]);
  expect("empty pool", rankCandidates([], { now: NOW }), []);
  expect("zero limit", rankCandidates(pool, { limit: 0, now: NOW }), []);
}

console.log("\n[7] candidate payload: preview is trimmed, nothing else leaks");

{
  const longAbstract = `${"word ".repeat(120)}end`;
  const candidate = toCandidate(
    paper({
      arxivId: "2301.12345",
      abstract: longAbstract,
      publishedDate: new Date(NOW - 3 * YEARS - 10 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    NOW,
  );

  expect("preview never exceeds 281 chars (280 + ellipsis)", candidate.abstractPreview.length <= 281, true);
  expect("preview ends on the ellipsis", candidate.abstractPreview.endsWith("…"), true);
  expect("preview has no trailing space", candidate.abstractPreview.trim() === candidate.abstractPreview, true);
  expect("age in whole years", candidate.ageYears, 3);
  expect("id is forwarded", candidate.arxivId, "2301.12345");
  expect("no full abstract on the wire", "abstract" in candidate, false);
  expect("no canonicalId on the wire", "canonicalId" in candidate, false);

  const short = toCandidate(paper({ arxivId: "2301.99999", abstract: "Short abstract." }), NOW);
  expect("short abstracts are untouched", short.abstractPreview, "Short abstract.");
  expect(
    "undated paper has no age",
    toCandidate(paper({ arxivId: "2301.00001", publishedDate: null }), NOW).ageYears,
    null,
  );
}

console.log("\n[8] ids are validated before any network call");

{
  // getArxivPaper() rejects for a malformed id before any fetch, so these
  // assertions prove the endpoint cannot be turned into an arbitrary-URL fetcher.
  await expectRejects("plain text is rejected", () => getArxivPaper("not-an-id"), "INVALID_QUERY");
  await expectRejects(
    "path traversal is rejected",
    () => getArxivPaper("../../etc/passwd"),
    "INVALID_QUERY",
  );
  await expectRejects(
    "an id with a query string is rejected",
    () => getArxivPaper("2301.12345?foo=bar"),
    "INVALID_QUERY",
  );
  await expectRejects(
    "over-long input is rejected",
    () => getArxivPaper("1".repeat(40)),
    "INVALID_QUERY",
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll paper-picker checks passed.\n");
