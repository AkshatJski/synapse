/**
 * scripts/verify-ideas.mts
 *
 * Offline checks for the "I have a paper" flow: URL/id parsing, the ideas
 * schema, normalisation, and the prompt wiring for both LLM calls. No network,
 * no API keys, no cost - `fetch` is replaced with a stub.
 *
 * Run with:  npx tsx scripts/verify-ideas.mts
 */

// Must be set before importing the modules: lib/env.ts snapshots process.env.
process.env.GROQ_API_KEY = "test-groq-key";
process.env.GEMINI_API_KEY = "";
process.env.LLM_PROVIDER = "groq";

import { arxivIdFromInput } from "@/lib/arxiv";
import { formatIdea, normaliseIdeas, ProjectIdeasSchema, type ProjectIdea } from "@/lib/ideas";
import type { RoadmapRequest } from "@/lib/llm";
const { generateProjectIdeas, generateRoadmap } = await import("@/lib/llm");

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${String(actual)} (expected ${String(expected)})`);
}

// ---- 1. pasted links and ids ------------------------------------------------
console.log("\n[1] arxivIdFromInput accepts links, versions and legacy ids");
{
  const cases: [string, string | null][] = [
    ["1706.03762", "1706.03762"],
    ["1706.03762v5", "1706.03762"],
    ["arXiv:1706.03762", "1706.03762"],
    ["https://arxiv.org/abs/1706.03762", "1706.03762"],
    ["https://arxiv.org/abs/1706.03762v2", "1706.03762"],
    ["https://arxiv.org/pdf/1706.03762v2.pdf", "1706.03762"],
    ["https://arxiv.org/abs/1706.03762?context=cs", "1706.03762"],
    ["https://arxiv.org/abs/1706.03762/", "1706.03762"],
    ["https://arxiv.org/abs/hep-th/9901001", "hep-th/9901001"],
    ["https://arxiv.org/pdf/hep-th/9901001v2.pdf", "hep-th/9901001"],
    ["not an id", null],
    ["../../etc/passwd", null],
    ["1706.03762<script>", null],
    ["", null],
  ];

  for (const [input, expected] of cases) {
    check(input || "(empty)", arxivIdFromInput(input), expected);
  }
}

// ---- 2. the ideas contract --------------------------------------------------
console.log("\n[2] ProjectIdeasSchema enforces exactly three usable ideas");
{
  const ideas: ProjectIdea[] = [
    {
      title: "Attention From Scratch",
      pitch: "Build the smallest possible transformer block and watch it learn.",
      build: "A notebook that trains a tiny attention model on a toy sequence.",
      difficulty: "beginner",
    },
    {
      title: "Attention Visualizer",
      pitch: "See which tokens a trained model actually looks at.",
      build: "A small web app that renders attention heatmaps.",
      difficulty: "intermediate",
    },
    {
      title: "Sparse Attention Benchmark",
      pitch: "Compare full attention against a sparse variant on the same data.",
      build: "A benchmark harness with a latency and accuracy table.",
      difficulty: "advanced",
    },
  ];

  check("three ideas pass", ProjectIdeasSchema.safeParse({ ideas }).success, true);
  check(
    "two ideas fail",
    ProjectIdeasSchema.safeParse({ ideas: ideas.slice(0, 2) }).success,
    false,
  );
  check(
    "an unknown difficulty fails",
    ProjectIdeasSchema.safeParse({
      ideas: [{ ...ideas[0], difficulty: "expert" }, ideas[1], ideas[2]],
    }).success,
    false,
  );

  const normalised = normaliseIdeas({
    ideas: [
      { ...ideas[0], title: "  Attention From Scratch  " },
      { ...ideas[0], title: "attention from scratch" },
      ideas[1],
    ],
  });

  check("title is trimmed", normalised[0].title, "Attention From Scratch");
  check("duplicate titles collapse", normalised.length, 2);
  check("formatIdea carries the title", formatIdea(ideas[0]).startsWith("Attention From Scratch"), true);
}

// ---- 3. the paper metadata reaches both prompts ----------------------------
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

const ideasPayload = JSON.stringify({
  ideas: [
    {
      title: "Attention From Scratch",
      pitch: "Build the smallest possible transformer block and watch it learn.",
      build: "A notebook that trains a tiny attention model on a toy sequence.",
      difficulty: "beginner",
    },
    {
      title: "Attention Visualizer",
      pitch: "See which tokens a trained model actually looks at.",
      build: "A small web app that renders attention heatmaps.",
      difficulty: "intermediate",
    },
    {
      title: "Sparse Attention Benchmark",
      pitch: "Compare full attention against a sparse variant on the same data.",
      build: "A benchmark harness with a latency and accuracy table.",
      difficulty: "advanced",
    },
  ],
});

const roadmapPayload = JSON.stringify({
  projectTitle: "Idea Project",
  paperSummaryELI5: "Attention lets a model weigh tokens against each other instead of treating them equally.",
  prerequisiteConcepts: ["matrix multiplication"],
  steps: [
    {
      title: "Load a tiny dataset",
      description: "Download and inspect a small sequence dataset for the rest of the project.",
      codeSnippet: "```python\nprint('hi')\n```",
      estimatedTime: "1 hour",
    },
    {
      title: "Implement the idea",
      description: "Write the smallest version of the chosen project and check the shapes.",
      codeSnippet: "```python\nprint('ok')\n```",
      estimatedTime: "2 hours",
    },
    {
      title: "Measure it",
      description: "Run the project on the toy data and record one honest metric.",
      codeSnippet: "```python\nprint('done')\n```",
      estimatedTime: "2 hours",
    },
  ],
});

let captured = "";

(globalThis as { fetch: unknown }).fetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("api.groq.com")) throw new Error(`unexpected call to ${url}`);

  captured = String(init?.body ?? "");
  const content = captured.includes("paperSummaryELI5") ? roadmapPayload : ideasPayload;

  return new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}) as typeof fetch;

console.log("\n[3] ideas call sees the paper, language and skill level");
{
  const ideas = await generateProjectIdeas({
    paper,
    domain: "Computer Vision",
    language: "Python",
    skillLevel: "beginner",
  });

  const sent = JSON.parse(captured) as { messages: { content: string }[] };
  const prompt = sent.messages.map((message) => message.content).join("\n");

  check("three ideas returned", ideas.length, 3);
  check("first title", ideas[0].title, "Attention From Scratch");
  check("paper title in prompt", prompt.includes("A Test Paper About Attention"), true);
  check("language in prompt", prompt.includes("TARGET LANGUAGE: Python"), true);
  check("skill in prompt", prompt.includes("SKILL LEVEL: beginner"), true);
}

console.log("\n[4] a chosen idea is carried into the roadmap prompt");
{
  const request: RoadmapRequest = {
    paper,
    domain: "Computer Vision",
    language: "Python",
    skillLevel: "beginner",
    projectIdea: "Attention Visualizer. Show which tokens the model looks at.",
  };

  const roadmap = await generateRoadmap(request);
  const sent = JSON.parse(captured) as { messages: { content: string }[] };
  const prompt = sent.messages.map((message) => message.content).join("\n");

  check("roadmap returned", roadmap.projectTitle, "Idea Project");
  check("idea delimiters present", prompt.includes("<<<IDEA_START"), true);
  check("idea text present", prompt.includes("Attention Visualizer"), true);
  check("paper still present", prompt.includes("A Test Paper About Attention"), true);
}

console.log(
  failures === 0
    ? "\nPASS — pasted papers, ideas and the chosen-idea prompt behave.\n"
    : `\nFAIL — ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
