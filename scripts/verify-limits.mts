/**
 * scripts/verify-limits.mts
 *
 * Offline checks for `lib/rate-limit.ts`. The limiter is a speed bump, not a
 * security boundary, but an off-by-one here either blocks the first legitimate
 * request or lets one extra through on every window — both worth pinning.
 *
 * The clock is injected everywhere, so this spec never sleeps.
 *
 * Run with:  npm run verify:limits
 */

import { FixedWindowLimiter } from "@/lib/rate-limit";

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${JSON.stringify(expected)}`);
    console.log(`       actual   ${JSON.stringify(actual)}`);
    return;
  }
  console.log(`  ok   ${label}`);
}

const T0 = 1_700_000_000_000;

console.log("\n[1] exactly `limit` requests pass, the next one is blocked");

{
  const limiter = new FixedWindowLimiter(3, 60_000);
  const results = [0, 1, 2, 3].map((index) => limiter.check("user-a", T0 + index));

  expect("first three allowed", results.slice(0, 3).map((r) => r.ok), [true, true, true]);
  expect("fourth blocked", results[3].ok, false);
  expect("remaining counts down", results.map((r) => r.remaining), [2, 1, 0, 0]);
  expect("a blocked request says when to retry", results[3].retryAfterSeconds > 0, true);
}

console.log("\n[2] keys are independent");

{
  const limiter = new FixedWindowLimiter(1, 60_000);
  expect("user-a first", limiter.check("user-a", T0).ok, true);
  expect("user-b unaffected", limiter.check("user-b", T0).ok, true);
  expect("user-a now blocked", limiter.check("user-a", T0 + 1).ok, false);
}

console.log("\n[3] the window expires and the budget returns");

{
  const limiter = new FixedWindowLimiter(2, 1_000);
  limiter.check("k", T0);
  limiter.check("k", T0 + 10);
  expect("blocked inside the window", limiter.check("k", T0 + 20).ok, false);
  expect("allowed exactly at the boundary", limiter.check("k", T0 + 1_000).ok, true);
  expect("count restarted", limiter.check("k", T0 + 1_001).ok, true);
  expect("third in the new window blocked", limiter.check("k", T0 + 1_002).ok, false);
}

console.log("\n[4] retry-after is rounded up, never zero");

{
  const limiter = new FixedWindowLimiter(1, 1_000);
  limiter.check("k", T0);
  const blocked = limiter.check("k", T0 + 1);
  expect("at least one second", blocked.retryAfterSeconds >= 1, true);
  expect("never longer than the window", blocked.retryAfterSeconds <= 1, true);
}

console.log("\n[5] reset() clears state (test hook)");

{
  const limiter = new FixedWindowLimiter(1, 60_000);
  limiter.check("k", T0);
  limiter.reset();
  expect("allowed again", limiter.check("k", T0).ok, true);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll rate-limit checks passed.\n");
