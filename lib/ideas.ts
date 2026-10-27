/**
 * lib/ideas.ts
 *
 * The contract for "what could I build with this paper?".
 *
 * The model proposes a small, fixed number of projects. Validation lives here
 * (not in the route) so the same rules apply to every provider and can be
 * tested without a network. The chosen idea is prompt input, not a database
 * row: no migration is needed to remember it, because the roadmap's own title
 * and summary already describe what was built.
 */

import { z } from "zod";

import { SKILL_LEVELS, type SkillLevel } from "@/lib/roadmap";

export const ProjectIdeaSchema = z.object({
  title: z.string().min(3).max(120),
  /** One sentence that makes the project appealing. */
  pitch: z.string().min(20).max(280),
  /** One sentence describing the artifact the learner ends up with. */
  build: z.string().min(10).max(240),
  difficulty: z.enum(SKILL_LEVELS),
});

export const ProjectIdeasSchema = z.object({
  ideas: z.array(ProjectIdeaSchema).min(3).max(5),
});

export type ProjectIdea = z.infer<typeof ProjectIdeaSchema>;

/** Trims prose and drops duplicate titles (models occasionally repeat one). */
export function normaliseIdeas(raw: z.infer<typeof ProjectIdeasSchema>): ProjectIdea[] {
  const seen = new Set<string>();

  return raw.ideas
    .map((idea) => ({
      title: idea.title.trim(),
      pitch: idea.pitch.trim(),
      build: idea.build.trim(),
      difficulty: idea.difficulty as SkillLevel,
    }))
    .filter((idea) => {
      const key = idea.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The compact string sent to `/api/generate` after the user picks one. */
export function formatIdea(idea: ProjectIdea): string {
  return `${idea.title}. ${idea.pitch} The learner will build: ${idea.build}`;
}
