/**
 * lib/env.ts
 *
 * Single place that reads process.env. Nothing else in the app touches
 * `process.env` directly, so a missing key shows up in one obvious spot and the
 * UI can degrade to a setup screen instead of throwing a white page.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the two public Supabase values exist — enough for auth + RLS queries. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
}

/**
 * Assert-style accessor for server code paths that genuinely cannot work
 * without a configured backend. Returns the values so callers stay terse.
 */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).",
    );
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}

/* -------------------------------------------------------------------------- */
/*  LLM provider selection                                                     */
/* -------------------------------------------------------------------------- */

export type LlmProvider = "groq" | "gemini";

export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

export interface LlmCandidate {
  provider: LlmProvider;
  apiKey: string;
}

/**
 * Every provider that actually has a key, **preferred first**.
 *
 * Returning the whole list (instead of one winner) is what makes failover
 * possible: `generateRoadmap` walks it until a provider answers. `LLM_PROVIDER`
 * expresses a preference, availability still decides what is usable.
 */
export function resolveLlmProviders(): LlmCandidate[] {
  const preferred = (process.env.LLM_PROVIDER ?? "groq").toLowerCase();

  const all: LlmCandidate[] = [
    { provider: "groq", apiKey: GROQ_API_KEY },
    { provider: "gemini", apiKey: GEMINI_API_KEY },
  ];

  const available = all.filter((candidate) => candidate.apiKey.length > 0);

  return [
    ...available.filter((candidate) => candidate.provider === preferred),
    ...available.filter((candidate) => candidate.provider !== preferred),
  ];
}

/** Convenience for callers that only care about the primary. */
export function resolveLlmProvider(): LlmCandidate | null {
  return resolveLlmProviders()[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  OpenAlex (paper discovery)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Optional contact address for OpenAlex's "polite pool" — no key, no account,
 * no paid tier. An empty value is fine; OpenAlex simply has no one to contact.
 */
export const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO ?? "";
