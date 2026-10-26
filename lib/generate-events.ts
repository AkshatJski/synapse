/**
 * The wire protocol between `app/api/generate/route.ts` and
 * `components/generate-form.tsx`.
 *
 * The route used to answer with one JSON body at the very end, so the UI could
 * only guess at progress with a timer (D39). Now it streams newline-delimited
 * JSON: one object per line, in order. Stages are emitted by the code that is
 * about to do the work, so what the user reads is what is actually happening.
 *
 * Kept in its own module so the client never imports a route handler just for
 * types, and so the stage ids cannot drift apart between the two sides.
 */

export const GENERATE_STAGES = ["searching", "reading", "planning", "saving"] as const;

export type GenerateStage = (typeof GENERATE_STAGES)[number];

/** One line of the NDJSON response. */
export type GenerateEvent =
  | {
      type: "stage";
      stage: GenerateStage;
      /** Present on `reading`: the paper that was actually chosen. */
      paper?: { arxivId: string; title: string };
    }
  | { type: "done"; projectId: string }
  | {
      type: "error";
      /** Mirrors the HTTP status this error would have had before streaming. */
      status: number;
      message: string;
      code: string;
    };
