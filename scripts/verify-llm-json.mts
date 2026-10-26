/**
 * scripts/verify-llm-json.mts
 *
 * Offline regression check for `extractJson()` in lib/llm.ts — no network, no
 * API key, no cost.
 *
 * It exists because the parser used to strip markdown fences by matching the
 * first ```...``` pair *anywhere* in the response. Our schema asks the model to
 * put fenced code inside `codeSnippet` string values, so a perfectly good JSON
 * object was cut in half at the first ```python and rejected as "not a JSON
 * object" (BUG-011). Roughly half of all generations failed this way.
 *
 * Run with:  npx tsx scripts/verify-llm-json.mts
 */

import { extractJson } from "@/lib/llm";

let failures = 0;

function check(label: string, fn: () => unknown, expectedTitle: string | null) {
  try {
    const result = fn() as { projectTitle?: string };
    if (expectedTitle === null) {
      failures += 1;
      console.log(`  FAIL ${label}: parsed, but it should have been rejected`);
      return;
    }
    const title = result?.projectTitle;
    const ok = title === expectedTitle;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: projectTitle = ${String(title)}`);
  } catch (error) {
    if (expectedTitle === null) {
      console.log(`  ok   ${label}: rejected (${(error as Error).message})`);
      return;
    }
    failures += 1;
    console.log(`  FAIL ${label}: threw ${(error as Error).message}`);
  }
}

const model = {
  projectTitle: "Attention from Scratch",
  paperSummaryELI5: "A short explanation.",
  prerequisiteConcepts: ["matrix multiplication"],
  steps: [
    {
      title: "Build the attention block",
      description: "Implement scaled dot-product attention.",
      codeSnippet: "```python\nimport numpy as np\nprint(np.eye(3))\n```",
      estimatedTime: "2 hours",
    },
  ],
};

const json = JSON.stringify(model, null, 2);

console.log("\n[1] the bug: fenced code inside a JSON string");
check("codeSnippet with ```python", () => extractJson(json), "Attention from Scratch");

console.log("\n[2] still tolerant of the wrappers models add");
check("```json wrapper", () => extractJson("```json\n" + json + "\n```"), "Attention from Scratch");
check("prose before and after", () => extractJson(`Here is the JSON:\n${json}\nHope it helps!`), "Attention from Scratch");

console.log("\n[3] genuine garbage is still rejected");
check("no braces at all", () => extractJson("I cannot help with that."), null);
check("truncated mid-object", () => extractJson('{"projectTitle": "x", "steps": ['), null);

console.log(failures === 0 ? "\nPASS — extractJson survives fenced code.\n" : `\nFAIL — ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
