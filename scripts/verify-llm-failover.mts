/**
 * scripts/verify-llm-failover.mts
 *
 * Offline check for provider failover in `generateRoadmap()` — no network, no
 * API keys, no cost. `fetch` is replaced with a stub that answers per host.
 *
 * Locks in the behaviour added for BUG-012:
 *   1. A rate-limited primary fails over to the secondary (one request each).
 *   2. If every provider is rate-limited, the error is RATE_LIMITED and no
 *      provider is called twice.
 *   3. A *semantic* failure (garbage JSON) tries the repair on the same
 *      provider first, then falls over.
 *
 * Run with:  npx tsx scripts/verify-llm-failover.mts
 */

// Must be set before importing the modules: lib/env.ts snapshots process.env.
process.env.GROQ_API_KEY = "test-groq-key";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.LLM_PROVIDER = "gemini";

import type { RoadmapRequest } from "@/lib/llm";
const { generateRoadmap, LlmError } = await import("@/lib/llm");

const paper = {
  arxivId: "2301.00001",
  version: "v1",
  canonicalId: "http://arxiv.org/abs/2301.00001v1",
  title: "A Test Paper About Attention",
  abstract: "We test attention mechanisms on small datasets.",
  authors: [{ name: "A. Researcher", affiliation: null }],
  publishedDate: "2023-01-01T00:00:00.000Z",
  updatedDate: null,
  primaryCategory: "cs.CV",
  categories: ["cs.CV"],
  absUrl: "http://arxiv.org/abs/2301.00001v1",
  pdfUrl: null,
  comment: null,
  journalRef: null,
  doi: null,
};

const request: RoadmapRequest = {
  paper,
  domain: "Computer Vision",
  language: "Python",
  skillLevel: "beginner" as const,
};

const validRoadmap = JSON.stringify({
  projectTitle: "Attention From Scratch",
  paperSummaryELI5: "Attention weights tokens against each other so context can be learned.",
  prerequisiteConcepts: ["matrix multiplication"],
  steps: [
    {
      title: "Load a small dataset",
      description: "Download and inspect a tiny image dataset to use for the rest of the project.",
      codeSnippet: "```python\nimport torch\n```",
      estimatedTime: "1 hour",
    },
    {
      title: "Implement attention",
      description: "Write scaled dot-product attention and check the shapes on a toy tensor.",
      codeSnippet: "```python\nimport torch\n```",
      estimatedTime: "2 hours",
    },
    {
      title: "Train a tiny model",
      description: "Train for a few epochs and confirm the loss goes down on the validation split.",
      codeSnippet: "```python\nimport torch\n```",
      estimatedTime: "3 hours",
    },
  ],
});

let hostCalls: string[] = [];

function stubFetch(handlers: Record<string, () => Response>) {
  hostCalls = [];
  (globalThis as { fetch: unknown }).fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = url.includes("generativelanguage.googleapis.com")
      ? "gemini"
      : url.includes("api.groq.com")
        ? "groq"
        : "other";
    hostCalls.push(host);
    const handler = handlers[host];
    if (!handler) throw new Error(`unexpected call to ${host}`);
    return handler();
  }) as typeof fetch;
}

const geminiOk = () =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: validRoadmap }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const groqOk = () =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: validRoadmap }, finish_reason: "stop" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const tooMany = () => new Response("{}", { status: 429 });
const garbage = () =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: "I cannot help with that." }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${String(actual)} (expected ${String(expected)})`);
}

// ---- 1. primary rate-limited -> secondary answers ---------------------------
console.log("\n[1] gemini 429 -> groq succeeds");
stubFetch({ gemini: tooMany, groq: groqOk });
{
  const roadmap = await generateRoadmap(request);
  check("returned a roadmap", roadmap.projectTitle, "Attention From Scratch");
  check("call order", hostCalls.join(","), "gemini,groq");
}

// ---- 2. everything rate-limited -> one call each, RATE_LIMITED -------------
console.log("\n[2] both providers 429");
stubFetch({ gemini: tooMany, groq: tooMany });
{
  let code: string | undefined;
  try {
    await generateRoadmap(request);
  } catch (error) {
    code = error instanceof LlmError ? error.code : `unexpected: ${String(error)}`;
  }
  check("error code", code, "RATE_LIMITED");
  check("calls (no retry storm)", hostCalls.join(","), "gemini,groq");
}

// ---- 3. semantic failure repairs in place, then fails over -----------------
console.log("\n[3] gemini garbage twice -> groq succeeds");
stubFetch({ gemini: garbage, groq: groqOk });
{
  const roadmap = await generateRoadmap(request);
  check("returned a roadmap", roadmap.projectTitle, "Attention From Scratch");
  check("call order", hostCalls.join(","), "gemini,gemini,groq");
}

// ---- 4. a healthy primary is used exactly once (no speculative fallback) ---
console.log("\n[4] gemini healthy -> one call, groq untouched");
stubFetch({ gemini: geminiOk, groq: groqOk });
{
  const roadmap = await generateRoadmap(request);
  check("returned a roadmap", roadmap.projectTitle, "Attention From Scratch");
  check("call order", hostCalls.join(","), "gemini");
}

console.log(failures === 0 ? "\nPASS — failover behaves.\n" : `\nFAIL — ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
