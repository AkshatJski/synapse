/**
 * scripts/verify-export.mts
 *
 * Offline regression check for `roadmapToMarkdown()` in lib/export.ts. No
 * network, no DOM.
 *
 * The export is user-facing output: if a fence closes early, a step loses its
 * order, or the progress markers appear on a public share page, the file the
 * user keeps is wrong. The nasty case is the one that already broke JSON in
 * BUG-011 — a code snippet that itself contains a ``` fence — so it is asserted
 * directly here.
 *
 * Run with:  npm run verify:export
 */

import { markdownFilename, roadmapToMarkdown } from "@/lib/export";
import type { PaperRow, ProjectRow, StepRow } from "@/lib/types";

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

function expectIncludes(label: string, haystack: string, needle: string) {
  expect(label, haystack.includes(needle), true);
}

const project = {
  title: "Attention From Scratch",
  domain: "Computer Vision",
  language: "Python",
  skill_level: "intermediate",
  overview: "Build a small vision transformer and train it on CIFAR-10.",
  eli5_summary: "A transformer that looks at patches of an image like words in a sentence.",
  prerequisite_concepts: ["Matrix multiplication", "Gradient descent", "PyTorch basics"],
  created_at: "2026-10-26T15:00:00.000Z",
} satisfies Pick<
  ProjectRow,
  | "title"
  | "domain"
  | "language"
  | "skill_level"
  | "overview"
  | "eli5_summary"
  | "prerequisite_concepts"
  | "created_at"
>;

const paper = {
  arxiv_id: "2010.11929",
  title: "An Image is Worth 16x16 Words",
  authors: [
    { name: "Alexey Dosovitskiy", affiliation: null },
    { name: "Lucas Beyer", affiliation: null },
  ],
  published_date: "2020-10-22T00:00:00.000Z",
  abs_url: "https://arxiv.org/abs/2010.11929",
  abstract: "We show that a pure transformer applied directly to image patches works well.",
} satisfies Pick<PaperRow, "arxiv_id" | "title" | "authors" | "published_date" | "abs_url" | "abstract">;

function step(overrides: Partial<StepRow> & { id: string; order_index: number }): StepRow {
  const { id, order_index, ...rest } = overrides;

  return {
    id,
    project_id: "11111111-1111-4111-8111-111111111111",
    order_index,
    title: `Step ${order_index}`,
    description: `Do the thing for step ${order_index}.`,
    code_snippet: null,
    estimated_time: "1 h",
    is_completed: false,
    created_at: "2026-10-26T15:00:00.000Z",
    ...rest,
  };
}

console.log("\n[1] structure: heading, metadata, summary, prerequisites");

{
  const markdown = roadmapToMarkdown({ project, steps: [step({ id: "a", order_index: 0 })], paper });

  expectIncludes("title as H1", markdown, "# Attention From Scratch");
  expectIncludes("domain / language / level", markdown, "**Domain:** Computer Vision · **Language:** Python · **Level:** intermediate");
  expectIncludes("paper link", markdown, "[An Image is Worth 16x16 Words](https://arxiv.org/abs/2010.11929)");
  expectIncludes("arXiv id", markdown, "arXiv:2010.11929");
  expectIncludes("ELI5 preferred over overview", markdown, "looks at patches of an image");
  expectIncludes("prerequisite 1", markdown, "- Matrix multiplication");
  expectIncludes("prerequisite 3", markdown, "- PyTorch basics");
  expectIncludes("created date", markdown, "**Created:** 2026-10-26");
  expectIncludes("trailing credit", markdown, "Generated with Synapse");
  expect("no tripled blank lines", /\n{3,}/.test(markdown), false);
}

console.log("\n[2] steps are ordered by order_index, not array position");

{
  const markdown = roadmapToMarkdown({
    project,
    steps: [
      step({ id: "third", order_index: 2, title: "Third" }),
      step({ id: "first", order_index: 0, title: "First" }),
      step({ id: "second", order_index: 1, title: "Second" }),
    ],
  });

  const first = markdown.indexOf("### 1. [ ] First");
  const second = markdown.indexOf("### 2. [ ] Second");
  const third = markdown.indexOf("### 3. [ ] Third");

  expect("first step numbered 1", first > -1, true);
  expect("ordering is 1 < 2 < 3", first < second && second < third, true);
}

console.log("\n[3] progress markers: owner export vs public share");

{
  const steps = [
    step({ id: "a", order_index: 0, title: "Done step", is_completed: true }),
    step({ id: "b", order_index: 1, title: "Todo step", is_completed: false }),
  ];

  const owned = roadmapToMarkdown({ project, steps });
  expectIncludes("owner sees progress count", owned, "**Progress:** 1/2 steps complete");
  expectIncludes("checked box", owned, "### 1. [x] Done step");
  expectIncludes("unchecked box", owned, "### 2. [ ] Todo step");
  expectIncludes("done status line", owned, "**Status:** done");

  const shared = roadmapToMarkdown({ project, steps, includeProgress: false });
  expect("share page has no progress count", shared.includes("**Progress:**"), false);
  expect("share page has no boxes", shared.includes("[x]") || shared.includes("[ ]"), false);
  expectIncludes("share page still numbers steps", shared, "### 2. Todo step");
}

console.log("\n[4] code fences survive a fence inside the snippet (BUG-011 shape)");

{
  const snippet = '```python\nprint("hello")\n```\n';
  const markdown = roadmapToMarkdown({
    project,
    steps: [step({ id: "a", order_index: 0, title: "Snippet", code_snippet: snippet })],
  });

  expectIncludes("opens with a four-backtick fence", markdown, "````python");
  expectIncludes("closes with a four-backtick fence", markdown, "\n````\n");
  expect("the inner triple fence is preserved", markdown.includes("```python\nprint"), true);
}

console.log("\n[5] labels and missing pieces");

{
  const noPaper = roadmapToMarkdown({ project, steps: [] });
  expect("no paper section without a paper", noPaper.includes("## The paper"), false);
  expect("empty roadmap is still a document", noPaper.includes("# Attention From Scratch"), true);

  const fallbackSummary = roadmapToMarkdown({
    project: { ...project, eli5_summary: null },
    steps: [],
  });
  expectIncludes("overview used when ELI5 is missing", fallbackSummary, "Build a small vision transformer");

  const noPrereqs = roadmapToMarkdown({
    project: { ...project, prerequisite_concepts: [] },
    steps: [],
  });
  expect("empty prerequisites section is omitted", noPrereqs.includes("## Prerequisites"), false);
}

console.log("\n[6] filenames");

{
  expect("lowercase, hyphenated", markdownFilename("Attention From Scratch!"), "attention-from-scratch.md");
  expect("punctuation collapses", markdownFilename("C++ / Python: a roadmap"), "c-python-a-roadmap.md");
  expect("empty title falls back", markdownFilename("!!!"), "synapse-roadmap.md");
  expect("length is bounded", markdownFilename("a".repeat(200)).length <= 63, true);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}

console.log("\nAll export checks passed.\n");
