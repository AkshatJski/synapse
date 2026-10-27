/**
 * scripts/verify-arxiv-retry.mts
 *
 * Regression check for the arXiv retry policy (BUG-010, amended by BUG-016).
 * Runs offline: `fetch` is replaced with a stub that returns fixed statuses, so
 * this asserts *our* behaviour, not arXiv's availability.
 *
 * Run with:  npm run verify:arxiv:retry
 *
 * What it locks in:
 *   1. A 429 is retried exactly ONCE, then surfaces RATE_LIMITED. This is the
 *      documented exception to "never retry a 4xx" (BUG-016); arXiv's guidance
 *      is still to back off, so the default gap stays >= 3s.
 *   2. A 5xx is retried once, then surfaces RATE_LIMITED.
 *   3. Every other 4xx (e.g. 400) fails after exactly ONE request.
 *   4. A Retry-After header overrides the default gap.
 */

import { ArxivError, searchArxivPapers } from "../lib/arxiv.ts";

const realFetch = globalThis.fetch;
let calls = 0;
let callTimes: number[] = [];

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2301.12345v1</id>
    <title>A stubbed paper</title>
    <summary>An abstract.</summary>
    <published>2026-01-01T00:00:00Z</published>
    <updated>2026-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

/** Returns `statuses` in order, then repeats the last one. */
function stubFetch(statuses: number[], headers: Record<string, string> = {}) {
  calls = 0;
  callTimes = [];
  globalThis.fetch = (async () => {
    const index = Math.min(calls, statuses.length - 1);
    const status = statuses[index];
    calls += 1;
    callTimes.push(Date.now());

    if (status === 200) {
      return new Response(ATOM_FEED, { status, headers: { "content-type": "application/atom+xml" } });
    }

    return new Response("stub", { status, headers });
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}: ${String(actual)} (expected ${String(expected)})`);
}

async function expectArxivError(label: string) {
  try {
    await searchArxivPapers("vision transformer", 1);
  } catch (error) {
    if (error instanceof ArxivError) {
      console.log(`  ok   ${label}: ${error.code} (status ${error.status ?? "none"})`);
      return error;
    }
    failures += 1;
    console.log(`  FAIL ${label}: threw ${String(error)} instead of ArxivError`);
    return null;
  }
  failures += 1;
  console.log(`  FAIL ${label}: resolved, expected an ArxivError`);
  return null;
}

// ---- 1. 429 is retried once, with the default backoff -----------------------
console.log("\n[1] HTTP 429 (rate limited) — one retry, then RATE_LIMITED");
stubFetch([429]);
const startedAt = Date.now();
const rateError = await expectArxivError("throws RATE_LIMITED");
const elapsed = Date.now() - startedAt;
restoreFetch();
check("requests made", calls, 2);
check("error code", rateError?.code, "RATE_LIMITED");
check("error status", rateError?.status, 429);
check("backed off >= 3s", elapsed >= 3_000, true);
console.log(`       (elapsed ${elapsed}ms across ${calls} attempts)`);

// ---- 2. 5xx retries once, then gives up ------------------------------------
console.log("\n[2] HTTP 503 (server fault) — one retry, then RATE_LIMITED");
stubFetch([503]);
const serverError = await expectArxivError("throws after retries");
restoreFetch();
check("requests made", calls, 2);
check("error code", serverError?.code, "RATE_LIMITED");

// ---- 3. Any other 4xx is final ---------------------------------------------
console.log("\n[3] HTTP 400 (bad request) — no retry");
stubFetch([400]);
const badRequestError = await expectArxivError("throws HTTP_ERROR");
restoreFetch();
check("requests made", calls, 1);
check("error code", badRequestError?.code, "HTTP_ERROR");
check("error status", badRequestError?.status, 400);

// ---- 4. Retry-After overrides the default gap ------------------------------
console.log("\n[4] 429 + Retry-After: 1 — retried after ~1s, then succeeds");
stubFetch([429, 200], { "Retry-After": "1" });
const retryStartedAt = Date.now();
const papers = await searchArxivPapers("vision transformer", 1);
const retryElapsed = Date.now() - retryStartedAt;
restoreFetch();
check("requests made", calls, 2);
check("resolved with one paper", papers.length, 1);
check("waited >= 0.9s", retryElapsed >= 900, true);
check("waited < 3s (header beat the default)", retryElapsed < 3_000, true);
console.log(`       (elapsed ${retryElapsed}ms)`);

console.log(
  failures === 0
    ? "\nPASS — retry policy matches BUG-010 + BUG-016.\n"
    : `\nFAIL — ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
