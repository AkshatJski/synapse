/**
 * scripts/verify-openalex.mts
 *
 * Offline regression check for the OpenAlex discovery client (BUG-016).
 * `fetch` is replaced with a stub, so this asserts *our* mapping and retry
 * behaviour with no network, no key and no database.
 *
 * What it locks in:
 *   1. The query is source-filtered to arXiv and floored at six months back,
 *      with the domain quoted and relevance-ranked (no date sort).
 *   2. Abstracts are rebuilt from OpenAlex's inverted index in position order.
 *   3. arXiv ids are extracted from abs/pdf URLs, http or https, with version
 *      suffixes and `.pdf` stripped; non-arXiv rows are skipped.
 *   4. Future-dated rows are dropped and duplicate ids collapse.
 *   5. The by-id lookup matches both URL schemes, and a malformed id never
 *      reaches the network.
 *   6. 429/503 retry once; Retry-After is honoured and capped; other statuses
 *      do not retry.
 *
 * Run with:  npm run verify:openalex
 */

import { ArxivError, retryAfterDelayMs } from "@/lib/arxiv";
import {
  abstractFromInvertedIndex,
  arxivIdFromUrl,
  getArxivPaperByOpenAlex,
  searchRecentArxiv,
} from "@/lib/openalex";

/* -------------------------------------------------------------------------- */
/*  Stub transport                                                            */
/* -------------------------------------------------------------------------- */

const realFetch = globalThis.fetch;
let calls: string[] = [];
let responder: (url: string) => Response | Promise<Response> = () => json({});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stub(next: (url: string) => Response | Promise<Response>) {
  calls = [];
  responder = next;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return responder(url);
  }) as typeof fetch;
}

function sequence(responses: Array<() => Response>) {
  let index = 0;
  stub(() => {
    const make = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return make();
  });
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/* -------------------------------------------------------------------------- */
/*  Assertions                                                                */
/* -------------------------------------------------------------------------- */

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${JSON.stringify(expected).slice(0, 200)}`);
    console.log(`       actual   ${JSON.stringify(actual).slice(0, 200)}`);
    return;
  }
  console.log(`  ok   ${label}`);
}

async function expectRejects(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    failures += 1;
    console.log(`  FAIL ${label} — resolved instead of rejecting`);
  } catch (error) {
    expect(label, error instanceof ArxivError ? error.code : "NOT_ARXIV_ERROR", code);
  }
}

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-10-27T00:00:00Z");

function work(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "A paper about vision",
    publication_date: "2026-09-01",
    locations: [
      {
        landing_page_url: "https://arxiv.org/abs/2610.00001v2",
        pdf_url: "https://arxiv.org/pdf/2610.00001v2.pdf",
      },
    ],
    best_oa_location: { pdf_url: null },
    authorships: [
      {
        author: { display_name: "A. Author" },
        institutions: [{ display_name: "Some University" }],
      },
      { author: { display_name: "B. Author" }, institutions: [] },
    ],
    abstract_inverted_index: { We: [0], present: [1], "Synapse.": [2] },
    primary_topic: { display_name: "Computer Vision" },
    concepts: [
      { display_name: "Computer vision" },
      { display_name: "Deep learning" },
      { display_name: "Artificial intelligence" },
      { display_name: "Fourth concept" },
    ],
    doi: "https://doi.org/10.1234/example",
    ...overrides,
  };
}

function results(rows: Array<Record<string, unknown>>) {
  return json({ meta: { count: rows.length }, results: rows });
}

/* -------------------------------------------------------------------------- */
/*  1. Query shape                                                            */
/* -------------------------------------------------------------------------- */

console.log("\n[1] query is source-filtered, six months back, relevance-ranked");

{
  stub(() => results([]));
  await searchRecentArxiv("Computer Vision", 20, { now: NOW });
  const url = new URL(calls[0]);
  const filter = url.searchParams.get("filter") ?? "";

  expect("arXiv source filter", filter.includes("locations.source.id:S4306400194"), true);
  expect("six-month floor", filter.includes("from_publication_date:2026-04-27"), true);
  expect("domain is quoted", url.searchParams.get("search"), '"Computer Vision"');
  expect("per-page is 50", url.searchParams.get("per-page"), "50");
  expect("no date sort", url.searchParams.has("sort"), false);
  restoreFetch();
}

/* -------------------------------------------------------------------------- */
/*  2. Inverted-index abstracts                                               */
/* -------------------------------------------------------------------------- */

console.log("\n[2] abstracts are rebuilt in position order");

{
  expect(
    "unsorted positions",
    abstractFromInvertedIndex({ "world.": [2], Hello: [0], brave: [1] }),
    "Hello brave world.",
  );
  expect(
    "a word at several positions",
    abstractFromInvertedIndex({ word: [3, 1], again: [2], first: [0] }),
    "first word again word",
  );
  expect("missing index", abstractFromInvertedIndex(null), "");
  restoreFetch();
}

/* -------------------------------------------------------------------------- */
/*  3. arXiv id extraction                                                    */
/* -------------------------------------------------------------------------- */

console.log("\n[3] arXiv ids come out of abs/pdf URLs, versions stripped");

{
  expect("abs + version", arxivIdFromUrl("https://arxiv.org/abs/2610.00001v3"), "2610.00001");
  expect("pdf + version + .pdf", arxivIdFromUrl("https://arxiv.org/pdf/2610.00001v3.pdf"), "2610.00001");
  expect("legacy id over http", arxivIdFromUrl("http://arxiv.org/abs/cs/0112017"), "cs/0112017");
  expect("non-arXiv URL", arxivIdFromUrl("https://doi.org/10.1234/example"), null);

  stub(() => results([work()]));
  const papers = await searchRecentArxiv("Computer Vision", 20, { now: NOW });
  restoreFetch();

  expect("one mapped paper", papers.length, 1);
  expect("id is bare", papers[0].arxivId, "2610.00001");
  expect("abstract rebuilt", papers[0].abstract, "We present Synapse.");
  expect("authors mapped", papers[0].authors.map((author) => author.name), [
    "A. Author",
    "B. Author",
  ]);
  expect("affiliation mapped", papers[0].authors[0].affiliation, "Some University");
  expect("primary topic", papers[0].primaryCategory, "Computer Vision");
  expect("categories capped at 3", papers[0].categories.length, 3);
  expect("doi prefix stripped", papers[0].doi, "10.1234/example");
  expect("versioned pdf kept", papers[0].pdfUrl, "https://arxiv.org/pdf/2610.00001v2.pdf");
}

/* -------------------------------------------------------------------------- */
/*  4. Skipped rows, future dates, duplicates                                 */
/* -------------------------------------------------------------------------- */

console.log("\n[4] rows without ids are skipped, future rows dropped, duplicates collapse");

{
  stub(() =>
    results([
      work({ title: "kept", publication_date: "2026-09-01" }),
      work({
        title: "no arxiv id",
        publication_date: "2026-09-02",
        locations: [{ landing_page_url: "https://doi.org/10.1234/not-arxiv" }],
        primary_location: { landing_page_url: "https://doi.org/10.1234/not-arxiv" },
        best_oa_location: { pdf_url: null },
      }),
      work({
        title: "future",
        publication_date: "2027-01-01",
        locations: [{ landing_page_url: "https://arxiv.org/abs/2610.00003" }],
      }),
      work({ title: "duplicate", publication_date: "2026-08-01" }),
      work({
        title: "older",
        publication_date: "2026-07-01",
        locations: [{ landing_page_url: "https://arxiv.org/abs/2610.00002" }],
      }),
    ]),
  );

  const papers = await searchRecentArxiv("Computer Vision", 20, { now: NOW });
  restoreFetch();

  expect(
    "kept ids, newest first",
    papers.map((paper) => paper.arxivId),
    ["2610.00001", "2610.00002"],
  );
  expect(
    "first duplicate wins",
    papers.find((paper) => paper.arxivId === "2610.00001")?.title,
    "kept",
  );
}

/* -------------------------------------------------------------------------- */
/*  5. By-id lookup                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n[5] by-id lookup matches both URL schemes");

{
  stub(() => results([work()]));
  const paper = await getArxivPaperByOpenAlex("2610.00001", { now: NOW });
  const filter = new URL(calls[0]).searchParams.get("filter") ?? "";
  restoreFetch();

  expect("http form", filter.includes("http://arxiv.org/abs/2610.00001"), true);
  expect("https form", filter.includes("https://arxiv.org/abs/2610.00001"), true);
  expect("mapped id", paper?.arxivId, "2610.00001");
  expect("mapped title", paper?.title, "A paper about vision");
}

{
  stub(() => results([]));
  await expectRejects(
    "path traversal never reaches fetch",
    () => getArxivPaperByOpenAlex("../../etc/passwd"),
    "INVALID_QUERY",
  );
  expect("no request made", calls.length, 0);
  restoreFetch();
}

/* -------------------------------------------------------------------------- */
/*  6. Retry policy                                                           */
/* -------------------------------------------------------------------------- */

console.log("\n[6] 429 retries once; Retry-After is honoured and capped");

{
  sequence([() => json({ error: "rate" }, 429, { "Retry-After": "0" }), () => results([work()])]);
  const papers = await searchRecentArxiv("Computer Vision", 20, { now: NOW });
  restoreFetch();

  expect("two requests", calls.length, 2);
  expect("second attempt succeeded", papers.length, 1);
}

{
  stub(() => json({ error: "rate" }, 429, { "Retry-After": "0" }));
  await expectRejects(
    "429 twice surfaces RATE_LIMITED",
    () => searchRecentArxiv("Computer Vision", 20, { now: NOW }),
    "RATE_LIMITED",
  );
  expect("still only two requests", calls.length, 2);
  restoreFetch();
}

{
  stub(() => json({ error: "bad" }, 400));
  await expectRejects(
    "400 does not retry",
    () => searchRecentArxiv("Computer Vision", 20, { now: NOW }),
    "HTTP_ERROR",
  );
  expect("one request", calls.length, 1);
  restoreFetch();
}

{
  const header = (value: string) =>
    new Response(null, { status: 429, headers: { "Retry-After": value } });

  expect("seconds header", retryAfterDelayMs(header("1")), 1_000);
  expect("header capped at 5s", retryAfterDelayMs(header("99")), 5_000);
  expect(
    "no header falls back to 2s",
    retryAfterDelayMs(new Response(null, { status: 429 }), 2_000),
    2_000,
  );

  const httpDateDelay = retryAfterDelayMs(
    header(new Date(Date.now() + 1_500).toUTCString()),
  );
  expect("HTTP-date header within range", httpDateDelay > 0 && httpDateDelay <= 1_500, true);
}

/* -------------------------------------------------------------------------- */

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll OpenAlex checks passed.\n");
