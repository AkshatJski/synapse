/**
 * lib/paper-lookup.ts
 *
 * One by-id lookup shared by the picker's "I have a paper" path and the ideas
 * endpoint. OpenAlex is the happy path; arXiv is the fallback for records it has
 * not indexed. Callers pass an already-validated bare id (D41), so this module
 * never accepts a URL or arbitrary text.
 */

import { ArxivError, getArxivPaper, type ArxivPaper } from "@/lib/arxiv";
import { getArxivPaperByOpenAlex } from "@/lib/openalex";

export async function fetchPaperById(paperId: string): Promise<ArxivPaper | null> {
  const viaOpenAlex = await getArxivPaperByOpenAlex(paperId).catch((error: unknown) => {
    // An invalid id is a programming error at this point; let it surface.
    if (error instanceof ArxivError && error.code === "INVALID_QUERY") throw error;
    return null;
  });

  return viaOpenAlex ?? (await getArxivPaper(paperId));
}
