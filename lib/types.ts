/**
 * lib/types.ts
 *
 * Hand-written row shapes for the Supabase tables. They mirror
 * `supabase/migrations/0001_init.sql`; if a column changes there, change it here
 * in the same commit.
 */

import type { SkillLevel } from "@/lib/roadmap";

export interface PaperAuthor {
  name: string;
  affiliation: string | null;
}

export interface PaperRow {
  id: string;
  arxiv_id: string;
  version: string | null;
  canonical_id: string | null;
  title: string;
  abstract: string;
  authors: PaperAuthor[];
  primary_category: string | null;
  categories: string[];
  published_date: string | null;
  abs_url: string | null;
  pdf_url: string | null;
  cached_at: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  paper_id: string;
  domain: string;
  language: string;
  skill_level: SkillLevel;
  title: string;
  overview: string;
  eli5_summary: string | null;
  prerequisite_concepts: string[];
  created_at: string;
  /** Null = private. Set by the 0002_sharing migration. */
  share_slug: string | null;
  shared_at: string | null;
}

export interface StepRow {
  id: string;
  project_id: string;
  order_index: number;
  title: string;
  description: string;
  code_snippet: string | null;
  estimated_time: string | null;
  is_completed: boolean;
  created_at: string;
}

/** Project plus the paper it was built from and step-progress counters. */
export interface ProjectWithProgress extends ProjectRow {
  papers: Pick<
    PaperRow,
    "id" | "arxiv_id" | "title" | "abs_url" | "pdf_url" | "primary_category" | "published_date"
  > | null;
  steps: { is_completed: boolean }[];
}
