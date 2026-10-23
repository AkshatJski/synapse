/**
 * scripts/verify-arxiv.ts
 *
 * Manual smoke check for lib/arxiv.ts against the real API.
 * Run with:  node scripts/verify-arxiv.ts
 * (Node 24 strips TypeScript types natively, no build step needed.)
 */

import { ArxivError, searchArxivPapers } from "../lib/arxiv.ts";

async function main() {
  console.log("→ searching arXiv for 'vision transformer' (3 results)\n");

  const papers = await searchArxivPapers("vision transformer", 3);

  if (papers.length === 0) {
    console.log("No papers returned.");
    return;
  }

  for (const [index, paper] of papers.entries()) {
    console.log(`[${index + 1}] ${paper.title}`);
    console.log(`    id        : ${paper.arxivId} (version ${paper.version ?? "none"})`);
    console.log(`    published : ${paper.publishedDate}`);
    console.log(`    category  : ${paper.primaryCategory}  all: ${paper.categories.join(", ")}`);
    console.log(`    authors   : ${paper.authors.map((a) => a.name).join(", ") || "(none)"}`);
    console.log(`    pdf       : ${paper.pdfUrl}`);
    console.log(`    abstract  : ${paper.abstract.slice(0, 140)}...`);
    console.log("");
  }

  console.log(`✓ parsed ${papers.length} papers`);
}

main().catch((error: unknown) => {
  if (error instanceof ArxivError) {
    console.error(`✗ ArxivError [${error.code}] ${error.message}`);
  } else {
    console.error("✗ unexpected failure:", error);
  }
  process.exitCode = 1;
});
