/**
 * scripts/verify-llm.mts
 *
 * End-to-end check of the LLM layer against the real provider: fetch one paper
 * from arXiv, then run the same `generateRoadmap()` the API route runs. Catches
 * the failures that only appear on a real model — a retired model id (BUG-011),
 * truncated output, or JSON that fails the zod contract twice.
 *
 * Run with:  npx tsx scripts/verify-llm.mts
 * (tsx is needed only for the `@/` path alias; the script is not shipped code.)
 *
 * Requires GROQ_API_KEY (or GEMINI_API_KEY) in the environment.
 */

import { searchArxivPapers } from "@/lib/arxiv";
import { generateRoadmap } from "@/lib/llm";

async function main() {
  console.log("→ looking up a paper on arXiv");
  const papers = await searchArxivPapers("vision transformer", 5);

  if (papers.length === 0) {
    console.error("✗ arXiv returned no papers — cannot test the LLM layer.");
    process.exit(1);
  }

  const paper = papers[0];
  console.log(`  ${paper.arxivId}: ${paper.title}`);
  console.log(`  abstract: ${paper.abstract.length} chars`);

  console.log("\n→ generating a roadmap (this is the real provider call)\n");
  const startedAt = Date.now();

  try {
    const roadmap = await generateRoadmap({
      paper,
      domain: "Computer Vision",
      language: "Python",
      skillLevel: "beginner",
    });
    const elapsed = Date.now() - startedAt;

    console.log(`✓ valid roadmap in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`  title      : ${roadmap.projectTitle}`);
    console.log(`  steps      : ${roadmap.steps.length}`);
    console.log(`  concepts   : ${roadmap.prerequisiteConcepts.length}`);
    console.log(`  eli5 chars : ${roadmap.paperSummaryELI5.length}`);
    console.log(
      `  longest step description: ${Math.max(...roadmap.steps.map((step) => step.description.length))} chars`,
    );
    console.log(
      `  steps with code         : ${roadmap.steps.filter((step) => step.codeSnippet).length}`,
    );
    console.log("\nPASS\n");
  } catch (error) {
    console.error(`✗ failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.error(error);
    console.log("\nFAIL\n");
    process.exit(1);
  }
}

await main();
