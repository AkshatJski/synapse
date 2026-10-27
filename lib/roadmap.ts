import { z } from "zod";

/**
 * The contract between the LLM and the database.
 *
 * The system prompt asks for exactly this shape; this schema is how we *check*
 * rather than trust. Everything downstream (DB insert, UI) assumes a validated
 * `Roadmap`.
 */

export const SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const LANGUAGES = [
  "Python",
  "TypeScript",
  "JavaScript",
  "Rust",
  "Go",
  "Java",
  "C++",
  "C#",
  "Kotlin",
  "Swift",
  "R",
  "Julia",
] as const;
export type Language = (typeof LANGUAGES)[number];

export const DOMAINS = [
  "Computer Vision",
  "Natural Language Processing",
  "Reinforcement Learning",
  "Generative AI",
  "Graph Neural Networks",
  "Speech & Audio",
  "Robotics",
  "Recommender Systems",
  "Time Series & Forecasting",
  "Multimodal Learning",
  "AI Agents",
  "Federated Learning",
  "Causal Inference",
  "Information Retrieval",
  "3D Vision",
  "Video Understanding",
  "AI for Science",
  "Cybersecurity",
] as const;
export type Domain = (typeof DOMAINS)[number];

/**
 * Validation is intentionally *structural but forgiving*: types and array
 * bounds are enforced, prose length is not. A model that returns a great
 * 18-word description should not fail the whole request.
 */
const StepSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10),
  codeSnippet: z.string().nullish(),
  estimatedTime: z.string().nullish(),
});

export const RoadmapSchema = z.object({
  projectTitle: z.string().min(3).max(140),
  paperSummaryELI5: z.string().min(20),
  prerequisiteConcepts: z.array(z.string().min(1)).min(1).max(15),
  steps: z.array(StepSchema).min(3).max(14),
});

export type RawRoadmap = z.infer<typeof RoadmapSchema>;

export interface RoadmapStep {
  title: string;
  description: string;
  codeSnippet: string | null;
  estimatedTime: string;
}

export interface Roadmap {
  projectTitle: string;
  paperSummaryELI5: string;
  prerequisiteConcepts: string[];
  steps: RoadmapStep[];
}

/** Applies the defaults the schema deliberately leaves open. */
export function normaliseRoadmap(raw: RawRoadmap): Roadmap {
  return {
    projectTitle: raw.projectTitle.trim(),
    paperSummaryELI5: raw.paperSummaryELI5.trim(),
    prerequisiteConcepts: raw.prerequisiteConcepts
      .map((concept) => concept.trim())
      .filter((concept) => concept.length > 0),
    steps: raw.steps.map((step) => ({
      title: step.title.trim(),
      description: step.description.trim(),
      codeSnippet: step.codeSnippet?.trim() || null,
      estimatedTime: step.estimatedTime?.trim() || "30 minutes",
    })),
  };
}
