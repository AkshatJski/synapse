/**
 * scripts/verify-arxiv-retry.mts
 *
 * Regression check for BUG-010 (arXiv retry policy). Runs offline: `fetch` is
 * replaced with a stub that returns fixed statuses, so this asserts *our*
 * behaviour, not arXiv's availability.
 *
 * Run with:  node scripts/verify-arxiv-retry.mts
 *
 * What it locks in:
 *   1. A 429 must fail after exactly ONE request. arXiv's guidance is to back
 *      off; retrying inside the same request deepens the throttle.
 *   2. A 5xx may be retried, but only MAX_ATTEMPTS times (2).
 *   3. The delay between attempts must be >= 3s, per arXiv's request policy.
 */

import { ArxivError, searchArxivPapers } from "../lib/arxiv.ts";

const realFetch = globalThis.fetch;
let calls = 0;
const callTimes: number[] = [];

function stubFetch(status: number) {
  calls = 0;
  callTimes.length = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    callTimes.push(Date.now());
    return new Response("stub", { status });
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

// ---- 1. 429 must not be retried --------------------------------------------
console.log("\n[1] HTTP 429 (rate limited)");
stubFetch(429);
const rateError = await expectArxivError("throws RATE_LIMITED");
restoreFetch();
check("requests made", calls, 1);
check("error code", rateError?.code, "RATE_LIMITED");

// ---- 2. 5xx retries once, then gives up ------------------------------------
console.log("\n[2] HTTP 503 (server fault)");
stubFetch(503);
const startedAt = Date.now();
const serverError = await expectArxivError("throws after retries");
const elapsed = Date.now() - startedAt;
restoreFetch();
check("requests made", calls, 2);
check("error code", serverError?.code, "RATE_LIMITED");
check("backed off >= 3s", elapsed >= 3_000, true);
console.log(`       (elapsed ${elapsed}ms across ${calls} attempts)`);

console.log(failures === 0 ? "\nPASS — retry policy matches BUG-010.\n" : `\nFAIL — ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
