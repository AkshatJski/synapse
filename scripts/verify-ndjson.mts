/**
 * scripts/verify-ndjson.mts
 *
 * Offline regression check for `readNdjson()` in lib/ndjson.ts. No network.
 *
 * Why this exists: `/api/generate` now streams progress events, and the one bug
 * that would be invisible in a happy-path manual test is a chunk boundary. A
 * socket can split the response mid-object or mid-UTF-8 character; a naive
 * `text.split("\n")` + `JSON.parse` per chunk drops or corrupts events, which
 * shows up as a spinner that never finishes. This test feeds the reader every
 * possible two-chunk split of a real event stream.
 *
 * Run with:  npm run verify:ndjson
 */

import { readNdjson } from "@/lib/ndjson";
import type { GenerateEvent } from "@/lib/generate-events";

const encoder = new TextEncoder();
let failures = 0;

const EVENTS: GenerateEvent[] = [
  { type: "stage", stage: "searching" },
  { type: "stage", stage: "reading", paper: { arxivId: "2401.01234", title: "Élan and the naïve résumé — a study…" } },
  { type: "stage", stage: "planning" },
  { type: "stage", stage: "saving" },
  { type: "done", projectId: "0f0e0d0c-0000-4000-8000-000000000000" },
];

const payload = EVENTS.map((event) => `${JSON.stringify(event)}\n`).join("");
const bytes = encoder.encode(payload);

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(chunks: Uint8Array[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const event of readNdjson<GenerateEvent>(streamOf(chunks))) out.push(event);
  return out;
}

function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${JSON.stringify(expected).slice(0, 120)}`);
    console.log(`       actual   ${JSON.stringify(actual).slice(0, 120)}`);
    return;
  }
  console.log(`  ok   ${label}`);
}

console.log("\n[1] one chunk, the easy case");
expect("all five events in order", await collect([bytes]), EVENTS);

console.log("\n[2] every possible two-chunk split (mid-object, mid-string, mid-UTF-8)");
let splitFailures = 0;
for (let cut = 1; cut < bytes.length; cut += 1) {
  const events = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
  if (JSON.stringify(events) !== JSON.stringify(EVENTS)) {
    splitFailures += 1;
    if (splitFailures <= 3) {
      console.log(`  FAIL split at byte ${cut} (${bytes.length} total)`);
      const around = new TextDecoder().decode(bytes.slice(Math.max(0, cut - 8), cut + 8));
      console.log(`       around the cut: ${JSON.stringify(around)}`);
    }
  }
}
if (splitFailures === 0) {
  console.log(`  ok   ${bytes.length - 1} split points, all parsed identically`);
} else {
  failures += 1;
  console.log(`  FAIL ${splitFailures} split points corrupted the stream`);
}

console.log("\n[3] one byte at a time (worst case)");
const byteChunks: Uint8Array[] = [];
for (let index = 0; index < bytes.length; index += 1) byteChunks.push(bytes.slice(index, index + 1));
expect("byte-by-byte equals whole-chunk", await collect(byteChunks), EVENTS);

console.log("\n[4] blank lines and a missing trailing newline");
const messy = encoder.encode(`\n{"type":"stage","stage":"searching"}\n\n{"type":"done","projectId":"abc"}`);
expect("blank lines skipped, tail flushed", await collect([messy]), [
  { type: "stage", stage: "searching" },
  { type: "done", projectId: "abc" },
]);

console.log("\n[5] an empty body yields nothing (and does not throw)");
expect("zero events", await collect([new Uint8Array(0)]), []);

console.log(
  failures === 0
    ? `\nPASS — readNdjson survives any chunk boundary (${bytes.length - 1} splits, byte-by-byte).\n`
    : `\nFAIL — ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
