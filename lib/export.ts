/**
 * lib/export.ts
 *
 * Turns a saved roadmap into a Markdown document the user can keep.
 *
 * Pure on purpose: no database, no clock, no DOM. The button component collects
 * the rows it already rendered and hands them here, and `verify:export` checks
 * the output offline. A shared link is read-only, so the share page exports the
 * same document with every box unticked.
 */

import type { PaperRow, ProjectRow, StepRow } from "@/lib/types";

export interface ExportInput {
  project: Pick<
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
  steps: StepRow[];
  paper?: Pick<PaperRow, "arxiv_id" | "title" | "authors" | "published_date" | "abs_url" | "abstract"> | null;
  /** False on the public share page: progress belongs to the owner. */
  includeProgress?: boolean;
}

const LANGUAGE_TAGS: Record<string, string> = {
  Python: "python",
  TypeScript: "ts",
  JavaScript: "js",
  Rust: "rust",
  Go: "go",
  Java: "java",
  "C++": "cpp",
};

/**
 * A code snippet can itself contain a run of backticks (BUG-011: the model
 * fenced Python inside a JSON string). Pick a fence longer than the longest run
 * inside the snippet so the block cannot close early.
 */
function fenceFor(code: string): string {
  const runs = code.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

export function roadmapToMarkdown({
  project,
  steps,
  paper,
  includeProgress = true,
}: ExportInput): string {
  const ordered = [...steps].sort((a, b) => a.order_index - b.order_index);
  const done = ordered.filter((step) => step.is_completed).length;
  const languageTag = LANGUAGE_TAGS[project.language] ?? "";
  const lines: string[] = [];

  lines.push(`# ${project.title}`, "");

  if (paper) {
    const url = paper.abs_url ?? `https://arxiv.org/abs/${paper.arxiv_id}`;
    lines.push(`> Generated with [Synapse](https://synapse-seven-ebon.vercel.app) from`);
    lines.push(`> [${paper.title}](${url}) (arXiv:${paper.arxiv_id}).`);
    lines.push("");
  }

  lines.push(`**Domain:** ${project.domain} · **Language:** ${project.language} · **Level:** ${project.skill_level}`);

  if (includeProgress) {
    lines.push(`**Progress:** ${done}/${ordered.length} steps complete`);
  }

  const created = new Date(project.created_at);
  if (!Number.isNaN(created.getTime())) {
    lines.push(`**Created:** ${created.toISOString().slice(0, 10)}`);
  }
  lines.push("");

  lines.push("## Using this roadmap", "");
  lines.push(
    "Build the project in order. Each step says what to do, how long it should take, and includes a runnable snippet. Tick steps off as you go in the app.",
    "",
  );

  lines.push("## What this is about", "");
  lines.push(project.eli5_summary?.trim() || project.overview.trim(), "");

  if (project.prerequisite_concepts.length > 0) {
    lines.push("## Prerequisites", "");
    for (const concept of project.prerequisite_concepts) lines.push(`- ${concept}`);
    lines.push("");
  }

  lines.push("## Roadmap", "");

  ordered.forEach((step, index) => {
    const box = includeProgress ? (step.is_completed ? "[x]" : "[ ]") : "";
    const heading = box ? `${index + 1}. ${box} ${step.title}` : `${index + 1}. ${step.title}`;
    lines.push(`### ${heading}`, "");

    const meta: string[] = [];
    if (step.estimated_time) meta.push(`**Time:** ${step.estimated_time}`);
    if (includeProgress && step.is_completed) meta.push("**Status:** done");
    if (meta.length > 0) lines.push(meta.join(" · "), "");

    lines.push(step.description.trim(), "");

    if (step.code_snippet?.trim()) {
      const fence = fenceFor(step.code_snippet);
      lines.push(`${fence}${languageTag}`, step.code_snippet.trimEnd(), fence, "");
    }
  });

  if (paper) {
    lines.push("## The paper", "");
    if (paper.authors.length > 0) {
      lines.push(`**Authors:** ${paper.authors.map((author) => author.name).join(", ")}`, "");
    }
    if (paper.published_date) {
      lines.push(`**Published:** ${paper.published_date.slice(0, 10)}`, "");
    }
    lines.push(paper.abstract.trim(), "");
  }

  lines.push("---", "");
  lines.push("Generated with Synapse — read the paper, then actually build it.", "");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** `my-project-roadmap.md` — safe across Windows, macOS and Linux. */
export function markdownFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return `${slug || "synapse-roadmap"}.md`;
}
